import type { ProbeOutcome, RemoteProbePort } from '../../domain/sync/ports.js';
import type { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { CommandRunner } from './CommandRunner.js';

// Where each member's pinned host keys live. Per member, because it is their
// machine and their trust decision — one shared file would let one member's
// answer decide another's.
export const KNOWN_HOSTS_DIR = '/var/lib/kobox/sync';

// Turning ssh's own diagnostics into something a member can act on. The raw
// text goes nowhere near the page: it names our paths and our options.
function explain(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes('host key verification failed') || text.includes('remote host identification')) {
    return 'the machine answered, but with a different identity than last time — if you did not just reinstall it, stop and check why';
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
    return 'the machine did not answer in time — check the address, the port and any firewall in between';
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
    const result = await this.runner.run({
      command: 'sshpass',
      args: [
        '-e',
        'ssh',
        '-p',
        String(destination.port.value),
        // first sight pins the key; a CHANGE after that is refused, loudly
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        `UserKnownHostsFile=${knownHosts}`,
        '-o',
        'BatchMode=no',
        '-o',
        'PasswordAuthentication=yes',
        '-o',
        'PubkeyAuthentication=no',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'NumberOfPasswordPrompts=1',
        `${destination.account.value}@${destination.host.value}`,
        // the smallest question that proves the whole chain: reachable, the
        // account is accepted, and the folder they named is writable
        'test',
        '-w',
        destination.path.value,
      ],
      env: { SSHPASS: password.reveal() },
      timeoutMs: 30_000,
    });
    if (result.exitCode === 0) {
      return {
        ok: true,
        detail: 'the machine answered and the folder is writable',
        ...(await this.fingerprint(destination)),
      };
    }
    // exit 1 with no ssh diagnostic is `test -w` failing: we got in, the folder
    // is the problem — a distinction worth making, because the fix is different
    if (result.exitCode === 1 && result.stderr.trim() === '') {
      return {
        ok: false,
        detail: 'the account works, but that folder does not exist or cannot be written to',
        ...(await this.fingerprint(destination)),
      };
    }
    return { ok: false, detail: explain(result.stderr) };
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
