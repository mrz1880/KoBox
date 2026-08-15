import type { LocalPath } from '../../domain/sync/LocalPath.js';
import type { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { FileTransferPort, TransferOutcome } from '../../domain/sync/ports.js';
import type { CommandRunner } from './CommandRunner.js';
import { KNOWN_HOSTS_DIR } from './SshRemoteProbe.js';

// Large files over a home link: generous, but never unbounded. A transfer that
// hangs forever would hold the pass open behind it.
const TRANSFER_TIMEOUT_MS = 6 * 60 * 60 * 1000;

// Turning rsync's and ssh's diagnostics into a sentence a member can act on.
function explain(stderr: string, exitCode: number): string {
  const text = stderr.toLowerCase();
  if (text.includes('permission denied')) {
    return 'the machine refused the account, the password, or that folder';
  }
  if (text.includes('host key verification failed') || text.includes('identification has changed')) {
    return 'the machine answered with a different identity than the one you tested — nothing was sent';
  }
  if (text.includes('no space left')) {
    return 'the other machine has no room left';
  }
  if (text.includes('connection unexpectedly closed') || text.includes('connection reset')) {
    return 'the connection dropped part way through — it will resume where it stopped';
  }
  if (text.includes('connection refused') || text.includes('timed out')) {
    return 'the machine did not answer';
  }
  const trimmed = stderr.trim();
  return trimmed === '' ? `rsync stopped with code ${String(exitCode)}` : trimmed.split('\n')[0] ?? '';
}

export class RsyncOverSshTransfer implements FileTransferPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly knownHostsDir: string = KNOWN_HOSTS_DIR,
  ) {}

  async send(request: {
    destination: SyncDestination;
    password: RemotePassword;
    source: LocalPath;
    remoteFolder: string;
  }): Promise<TransferOutcome> {
    const { destination, password, source, remoteFolder } = request;
    // the same file the member pinned when they tested the connection: an
    // identity change between the test and the transfer must stop the transfer
    const knownHosts = `${this.knownHostsDir}/${destination.username.value}.known_hosts`;
    const sshOptions = [
      '-p',
      String(destination.port.value),
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      `UserKnownHostsFile=${knownHosts}`,
      '-o',
      'PubkeyAuthentication=no',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'NumberOfPasswordPrompts=1',
    ];
    const target = `${destination.account.value}@${destination.host.value}`;
    const env = { SSHPASS: password.reveal() };

    // Copying into a folder that does not exist scatters files at the root of
    // the member's NAS, which is worse than not copying at all.
    const made = await this.runner.run({
      command: 'sshpass',
      args: ['-e', 'ssh', ...sshOptions, target, 'mkdir', '-p', remoteFolder],
      env,
      timeoutMs: 60_000,
    });
    if (made.exitCode !== 0) {
      return { ok: false, detail: explain(made.stderr, made.exitCode) };
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
        '-e',
        `sshpass -e ssh ${sshOptions.join(' ')}`,
        source.value,
        `${target}:${remoteFolder}/`,
      ],
      env,
      timeoutMs: TRANSFER_TIMEOUT_MS,
    });
    return result.exitCode === 0
      ? { ok: true }
      : { ok: false, detail: explain(result.stderr, result.exitCode) };
  }
}
