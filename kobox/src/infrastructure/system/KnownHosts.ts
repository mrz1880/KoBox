import { HostKeyFingerprint } from '../../domain/sync/HostKeyFingerprint.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { Username } from '../../domain/user/Username.js';
import type { CommandRunner } from './CommandRunner.js';

// Where each member's recorded host keys live. Per member, because it is their
// machine and their trust decision: one shared file would let one member's
// answer decide another's.
export const KNOWN_HOSTS_DIR = '/var/lib/kobox/sync';

// The one place that decides how KoBox trusts the identity of a member's
// machine, for the check and for a transfer alike. This file is authoritative
// for the identity: the fingerprint the database shows is copied from it after
// a contact.
export class KnownHosts {
  constructor(
    private readonly runner: CommandRunner,
    private readonly dir: string = KNOWN_HOSTS_DIR,
  ) {}

  // Without this directory ssh cannot write the key it has just seen, and the
  // whole trust-on-first-use argument quietly stops holding: every connection
  // becomes a first sight. 0700 because a member's known_hosts is nobody
  // else's business.
  async prepare(): Promise<void> {
    await this.runner.run({
      command: 'mkdir',
      args: ['-p', '-m', '0700', this.dir],
      timeoutMs: 10_000,
    });
  }

  // The ssh options every contact with the member's machine carries: first
  // contact records its identity, a CHANGE after that is refused, loudly. The
  // legacy passed StrictHostKeyChecking=no with UserKnownHostsFile=/dev/null,
  // which hands the member's own credentials to whatever answers.
  sshOptions(username: Username): readonly string[] {
    return [
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${this.fileOf(username)}`,
    ];
  }

  // The member accepts the identity their machine presents now: the recorded
  // one goes, and the next contact records the new one as a first contact.
  async forget(destination: SyncDestination): Promise<void> {
    await this.runner.run({
      command: 'ssh-keygen',
      args: ['-R', hostEntry(destination), '-f', this.fileOf(destination.username)],
      timeoutMs: 10_000,
    });
  }

  // The identity recorded for the machine, read back once a contact is over:
  // what ssh checks, so what the member is shown. Best effort: a missing
  // fingerprint must never turn a working connection into a failed one.
  async identityOf(destination: SyncDestination): Promise<HostKeyFingerprint | undefined> {
    try {
      // "ssh-keygen -l -F" prints "<host> <type> SHA256:<hash>" per key found
      const found = await this.runner.run({
        command: 'ssh-keygen',
        args: ['-l', '-F', hostEntry(destination), '-f', this.fileOf(destination.username)],
        timeoutMs: 10_000,
      });
      const digest = /SHA256:[A-Za-z0-9+/]+=*/.exec(found.stdout)?.[0];
      return found.exitCode !== 0 || digest === undefined
        ? undefined
        : HostKeyFingerprint.parse(digest);
    } catch {
      return undefined;
    }
  }

  private fileOf(username: Username): string {
    return `${this.dir}/${username.value}.known_hosts`;
  }
}

// What ssh says when the machine presents another identity than the recorded
// one: "REMOTE HOST IDENTIFICATION HAS CHANGED", then "Host key verification
// failed"
export function presentsAnotherIdentity(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return (
    text.includes('host key verification failed') ||
    text.includes('remote host identification has changed')
  );
}

// The name ssh files a machine under: the bare host on the default port,
// "[host]:port" on any other
const DEFAULT_SSH_PORT = 22;

function hostEntry(destination: SyncDestination): string {
  const host = destination.host.value;
  const port = destination.port.value;
  return port === DEFAULT_SSH_PORT ? host : `[${host}]:${String(port)}`;
}
