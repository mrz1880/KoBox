import type { HostKeyTrust } from '../../domain/sync/HostKeyTrust.js';
import type { ProbeOutcome, RemoteProbePort } from '../../domain/sync/ports.js';
import type { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult, CommandRunner } from './CommandRunner.js';
import { KNOWN_HOSTS_DIR, KnownHosts, presentsAnotherIdentity } from './KnownHosts.js';

// How rsync reaches the member's folder: the remote shell, the folder itself,
// and the password in the environment
interface RemoteTarget {
  readonly ssh: string;
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
}

// rsync's exit status when it got in but could not read what it was asked for
const RSYNC_PARTIAL_TRANSFER = 23;

// Turning ssh's own diagnostics into something a member can act on. The raw
// text goes nowhere near the page: it names our paths and our options.
function explain(stderr: string): string {
  const text = stderr.toLowerCase();
  if (presentsAnotherIdentity(stderr)) {
    return 'the machine presented another identity than the one recorded for it: if you reinstalled it, test the connection again to accept its new identity, otherwise stop and check why';
  }
  if (text.includes('permission denied')) {
    return 'the machine answered but refused the account or the password';
  }
  if (text.includes('connection refused')) {
    return 'nothing is listening on that port';
  }
  if (text.includes('could not resolve') || text.includes('name or service not known')) {
    return 'that address does not resolve from here';
  }
  if (text.includes('timed out') || text.includes('operation timed out')) {
    return 'the machine did not answer in time: check the address, the port and any firewall in between';
  }
  if (text.includes('no route to host') || text.includes('network is unreachable')) {
    return 'no route from the box to that address';
  }
  return 'the connection did not go through';
}

export class SshRemoteProbe implements RemoteProbePort {
  private readonly knownHosts: KnownHosts;

  constructor(
    private readonly runner: CommandRunner,
    knownHostsDir: string = KNOWN_HOSTS_DIR,
    // where the empty local folders rsync sends are made, then removed
    private readonly scratchDir: string = tmpdir(),
    // the name of the folder made on the member's machine to prove writing:
    // unique, so it can never be one of theirs
    private readonly probeFolderName: () => string = () => `.kobox-write-check-${randomUUID()}`,
  ) {
    this.knownHosts = new KnownHosts(runner, knownHostsDir);
  }

  async probe(
    destination: SyncDestination,
    password: RemotePassword,
    trust: HostKeyTrust,
  ): Promise<ProbeOutcome> {
    await this.knownHosts.prepare();
    // sshpass -e reads the password from the environment. Never `-p <password>`:
    // that puts it in argv, where every other member of the box can read it
    // straight out of `ps`. This is the legacy's worst habit, and it is not
    // being carried over.
    const ssh = [
      'sshpass -e ssh',
      `-p ${String(destination.port.value)}`,
      ...this.knownHosts.sshOptions(destination.username),
      '-o BatchMode=no',
      '-o PasswordAuthentication=yes',
      '-o PubkeyAuthentication=no',
      '-o ConnectTimeout=10',
      '-o NumberOfPasswordPrompts=1',
    ].join(' ');
    // The questions are asked through rsync, the one thing the transfer needs:
    // a Synology gives a shell to administrators alone, so a shell command here
    // refused an ordinary account that rsync lets in. Listing the folder proves
    // the machine answers, takes the account, and has that folder.
    const remote: RemoteTarget = {
      ssh,
      root: `${destination.account.value}@${destination.host.value}:${destination.path.value}/`,
      env: { SSHPASS: password.reveal() },
    };
    const list = (): Promise<CommandResult> =>
      this.runner.run({
        command: 'rsync',
        args: ['--list-only', '-e', remote.ssh, remote.root],
        env: remote.env,
        timeoutMs: 30_000,
      });
    let result = await list();
    // The member accepts the identity the machine presents now. The recorded
    // one goes only once the machine has really presented another: a test run
    // while it is off must not leave the next transfer to take whatever
    // answers as a first contact.
    if (trust === 'accept-presented' && presentsAnotherIdentity(result.stderr)) {
      await this.knownHosts.forget(destination);
      result = await list();
    }
    if (result.exitCode === 0) {
      return { ...(await this.proveWriting(remote)), ...(await this.identity(destination)) };
    }
    // in, but the folder is missing: rsync reports it as a partial transfer
    if (result.exitCode === RSYNC_PARTIAL_TRANSFER) {
      return {
        ok: false,
        detail: 'the account works, but that folder does not exist or cannot be read',
        ...(await this.identity(destination)),
      };
    }
    return { ok: false, detail: explain(result.stderr) };
  }

  // Seeing the folder is not writing in it: on 2026-11-04 an account that
  // could list it was refused every transfer right after a green check. A
  // folder of our own is made there, then removed.
  private async proveWriting(remote: RemoteTarget): Promise<ProbeOutcome> {
    const probeFolder = this.probeFolderName();
    const written = await this.sendTree(remote, ['--recursive'], probeFolder);
    if (written.exitCode !== 0) {
      return { ok: false, detail: 'the account can sign in but cannot write in that folder' };
    }
    // Best effort: writing is what a transfer needs, so a folder left behind
    // does not fail the check. An empty tree sent with --delete would empty the
    // member's whole folder: the filters let the probe folder alone go, and
    // --max-delete caps the harm at one entry should they ever be wrong.
    await this.sendTree(remote, [
      '--recursive',
      '--delete',
      `--include=/${probeFolder}/`,
      '--exclude=*',
      '--max-delete=1',
    ]);
    return { ok: true, detail: 'the machine answered, and the account can write in that folder' };
  }

  // rsync sends an empty local tree, holding the given folder when there is
  // one, to the member's folder: nothing else of theirs is ever named
  private async sendTree(
    remote: RemoteTarget,
    options: readonly string[],
    folder?: string,
  ): Promise<CommandResult> {
    const tree = mkdtempSync(join(this.scratchDir, 'kobox-check-'));
    try {
      if (folder !== undefined) {
        mkdirSync(join(tree, folder));
      }
      return await this.runner.run({
        command: 'rsync',
        args: [...options, '--timeout=30', '-e', remote.ssh, `${tree}/`, remote.root],
        env: remote.env,
        timeoutMs: 60_000,
      });
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  }

  private async identity(destination: SyncDestination): Promise<Pick<ProbeOutcome, 'identity'>> {
    const identity = await this.knownHosts.identityOf(destination);
    return identity === undefined ? {} : { identity };
  }
}
