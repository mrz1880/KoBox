import type { ProbeOutcome, RemoteProbePort } from '../../domain/sync/ports.js';
import type { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult, CommandRunner } from './CommandRunner.js';

// How rsync reaches the member's folder: the remote shell, the folder itself,
// and the password in the environment
interface RemoteTarget {
  readonly ssh: string;
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
}

// Where each member's pinned host keys live. Per member, because it is their
// machine and their trust decision: one shared file would let one member's
// answer decide another's.
export const KNOWN_HOSTS_DIR = '/var/lib/kobox/sync';

// rsync's exit status when it got in but could not read what it was asked for
const RSYNC_PARTIAL_TRANSFER = 23;

// Turning ssh's own diagnostics into something a member can act on. The raw
// text goes nowhere near the page: it names our paths and our options.
function explain(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes('host key verification failed') || text.includes('remote host identification')) {
    return 'the machine answered, but with a different identity than last time: if you did not just reinstall it, stop and check why';
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

// A pinned fingerprint is the whole point: the legacy passed both
// StrictHostKeyChecking=no and UserKnownHostsFile=/dev/null, which hands the
// member's own credentials to whatever answers on that address.
function fingerprintOf(stdout: string): string | undefined {
  // `ssh-keyscan | ssh-keygen -lf -` prints "<bits> SHA256:<hash> <host> (<type>)"
  return /SHA256:[A-Za-z0-9+/=]+/.exec(stdout)?.[0];
}

export class SshRemoteProbe implements RemoteProbePort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly knownHostsDir: string = KNOWN_HOSTS_DIR,
    // where the empty local folders rsync sends are made, then removed
    private readonly scratchDir: string = tmpdir(),
    // the name of the folder made on the member's machine to prove writing:
    // unique, so it can never be one of theirs
    private readonly probeFolderName: () => string = () => `.kobox-write-check-${randomUUID()}`,
  ) {}

  async probe(destination: SyncDestination, password: RemotePassword): Promise<ProbeOutcome> {
    const knownHosts = `${this.knownHostsDir}/${destination.username.value}.known_hosts`;
    // Without this directory ssh cannot write the key it has just seen, and the
    // whole trust-on-first-use argument quietly stops holding: every connection
    // becomes a first sight. 0700 because a member's known_hosts is nobody
    // else's business.
    await this.runner.run({
      command: 'mkdir',
      args: ['-p', '-m', '0700', this.knownHostsDir],
      timeoutMs: 10_000,
    });
    // sshpass -e reads the password from the environment. Never `-p <password>`:
    // that puts it in argv, where every other member of the box can read it
    // straight out of `ps`. This is the legacy's worst habit, and it is not
    // being carried over.
    const ssh = [
      'sshpass -e ssh',
      `-p ${String(destination.port.value)}`,
      // first sight pins the key; a CHANGE after that is refused, loudly
      '-o StrictHostKeyChecking=accept-new',
      `-o UserKnownHostsFile=${knownHosts}`,
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
    const result = await this.runner.run({
      command: 'rsync',
      args: ['--list-only', '-e', remote.ssh, remote.root],
      env: remote.env,
      timeoutMs: 30_000,
    });
    if (result.exitCode === 0) {
      return { ...(await this.proveWriting(remote)), ...(await this.fingerprint(destination)) };
    }
    // in, but the folder is missing: rsync reports it as a partial transfer
    if (result.exitCode === RSYNC_PARTIAL_TRANSFER) {
      return {
        ok: false,
        detail: 'the account works, but that folder does not exist or cannot be read',
        ...(await this.fingerprint(destination)),
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

  private async fingerprint(
    destination: SyncDestination,
  ): Promise<{ fingerprint?: string }> {
    // best effort: a missing fingerprint must never turn a working connection
    // into a failed one
    try {
      const scan = await this.runner.run({
        command: 'ssh-keyscan',
        args: ['-p', String(destination.port.value), '-H', destination.host.value],
        timeoutMs: 15_000,
      });
      if (scan.exitCode !== 0 || scan.stdout.trim() === '') {
        return {};
      }
      const digest = await this.runner.run({
        command: 'ssh-keygen',
        args: ['-lf', '-'],
        stdin: scan.stdout,
        timeoutMs: 15_000,
      });
      const found = fingerprintOf(digest.stdout);
      return found === undefined ? {} : { fingerprint: found };
    } catch {
      return {};
    }
  }
}
