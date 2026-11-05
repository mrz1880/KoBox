import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileTransferPort, TransferOutcome } from '../../domain/sync/ports.js';
import { TransferFailure } from '../../domain/sync/TransferFailure.js';
import type { CommandResult, CommandRunner } from './CommandRunner.js';
import { KNOWN_HOSTS_DIR, KnownHosts, presentsAnotherIdentity } from './KnownHosts.js';

// Large files over a home link: generous, but never unbounded. A transfer that
// hangs forever would hold the pass open behind it.
const TRANSFER_TIMEOUT_MS = 6 * 60 * 60 * 1000;

// Turning rsync's and ssh's diagnostics into a failure a member can act on.
function explain(stderr: string, exitCode: number): TransferFailure {
  const text = stderr.toLowerCase();
  if (text.includes('permission denied')) {
    return TransferFailure.explained('refused');
  }
  if (presentsAnotherIdentity(stderr)) {
    return TransferFailure.explained('identity-changed');
  }
  if (text.includes('no space left')) {
    return TransferFailure.explained('no-room');
  }
  if (text.includes('connection unexpectedly closed') || text.includes('connection reset')) {
    return TransferFailure.explained('dropped');
  }
  if (text.includes('connection refused') || text.includes('timed out')) {
    return TransferFailure.explained('no-answer');
  }
  const firstLine = stderr.trim().split('\n')[0] ?? '';
  return firstLine === '' ? TransferFailure.stopped(exitCode) : TransferFailure.reported(firstLine);
}

type SendRequest = Parameters<FileTransferPort['send']>[0];

export class RsyncOverSshTransfer implements FileTransferPort {
  private readonly knownHosts: KnownHosts;

  constructor(
    private readonly runner: CommandRunner,
    knownHostsDir: string = KNOWN_HOSTS_DIR,
    private readonly scratchDir: string = tmpdir(),
  ) {
    this.knownHosts = new KnownHosts(runner, knownHostsDir);
  }

  async send(request: SendRequest): Promise<TransferOutcome> {
    // A machine never contacted has its identity recorded by this transfer,
    // as the check would have: a member who never tested the connection must
    // not see every transfer refused. A transfer never replaces a recorded
    // identity: only the member, testing the connection, can accept a new one.
    await this.knownHosts.prepare();
    const outcome = await this.carry(request);
    const identity = await this.knownHosts.identityOf(request.destination);
    return identity === undefined ? outcome : { ...outcome, identity };
  }

  private async carry(request: SendRequest): Promise<TransferOutcome> {
    const { destination, password, source, remoteFolder } = request;
    const sshOptions = [
      '-p',
      String(destination.port.value),
      ...this.knownHosts.sshOptions(destination.username),
      '-o',
      'PubkeyAuthentication=no',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'NumberOfPasswordPrompts=1',
    ];
    const target = `${destination.account.value}@${destination.host.value}`;
    const env = { SSHPASS: password.reveal() };
    const remoteShell = ['-e', `sshpass -e ssh ${sshOptions.join(' ')}`];
    // Copying into a folder that does not exist scatters files at the root of
    // the member's NAS, which is worse than not copying at all. The folders are
    // made by rsync itself, sending an empty tree of them: a Synology gives a
    // shell to administrators alone, so `mkdir -p` over ssh refused an
    // ordinary account allowed rsync. --recursive only: --archive would hand
    // the empty tree's own 0700 to the member's root folder.
    const root = destination.path.value;
    const relative = remoteFolder.startsWith(`${root}/`) ? remoteFolder.slice(root.length + 1) : '';
    const tree = mkdtempSync(join(this.scratchDir, 'kobox-sync-'));
    let made: CommandResult;
    try {
      mkdirSync(join(tree, relative), { recursive: true });
      made = await this.runner.run({
        command: 'rsync',
        args: ['--recursive', '--timeout=60', ...remoteShell, `${tree}/`, `${target}:${root}/`],
        env,
        timeoutMs: 60_000,
      });
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
    if (made.exitCode !== 0) {
      return { ok: false, failure: explain(made.stderr, made.exitCode) };
    }
    // ONE call. The legacy looped three times with its `break` commented out,
    // so every file crossed the link three times on every pass. Retry belongs to
    // the caller, which knows whether the failure is worth retrying.
    //
    // --partial --append-verify: a dropped connection resumes where it stopped
    // instead of starting the file again, and verifies what was already there.
    const result = await this.runner.run({
      command: 'rsync',
      args: [
        '--archive',
        '--partial',
        '--append-verify',
        '--timeout=120',
        ...remoteShell,
        source.value,
        `${target}:${remoteFolder}/`,
      ],
      env,
      timeoutMs: TRANSFER_TIMEOUT_MS,
    });
    return result.exitCode === 0
      ? { ok: true }
      : { ok: false, failure: explain(result.stderr, result.exitCode) };
  }
}
