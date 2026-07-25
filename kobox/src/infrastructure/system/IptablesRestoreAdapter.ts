import { readFile } from 'node:fs/promises';
import type { Cidr } from '../../domain/security/Cidr.js';
import type { FirewallApplyOutcome, FirewallApplyPort } from '../../domain/security/ports.js';
import type { ManagedFilesPort, RenderedFile } from '../../domain/shared/files.js';
import type { HealthProbePort } from '../../domain/user/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const RESTORE_TIMEOUT_MS = 10_000;

// A chain the renderer always emits: its presence in iptables-save is the
// proof that the persisted file still describes the LIVE tables (they do not
// survive a reboot — the file alone proves nothing).
const SENTINEL_CHAIN = ':kobox-meter-out';

// The anti-lockout guard. Ordering is the whole point:
//   1. read the persisted ruleset — identical content AND a live sentinel
//      chain means nothing to do;
//   2. snapshot the running tables (iptables-save);
//   3. iptables-restore the new ruleset from stdin (atomic per table);
//   4. probe the SSH lifeline — sshd must still accept local connections;
//   5. only then persist the file. On probe failure the snapshot is restored
//      and the file is left untouched, so a later apply retries the change.
export class IptablesRestoreAdapter implements FirewallApplyPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly files: ManagedFilesPort,
    private readonly probe: HealthProbePort,
    private readonly sshPort: number,
  ) {}

  async apply(rules: RenderedFile): Promise<FirewallApplyOutcome> {
    const current = await readFile(rules.path, 'utf8').catch(() => undefined);
    const snapshot = await runOrThrow(this.runner, {
      command: 'iptables-save',
      args: [],
      timeoutMs: RESTORE_TIMEOUT_MS,
    });
    if (current === rules.content && snapshot.stdout.includes(SENTINEL_CHAIN)) {
      return 'unchanged';
    }
    await runOrThrow(this.runner, {
      command: 'iptables-restore',
      args: [],
      stdin: rules.content,
      timeoutMs: RESTORE_TIMEOUT_MS,
    });

    const lifeline = await this.probe.checkSocket('127.0.0.1', this.sshPort);
    if (lifeline.state !== 'healthy') {
      await runOrThrow(this.runner, {
        command: 'iptables-restore',
        args: [],
        stdin: snapshot.stdout,
        timeoutMs: RESTORE_TIMEOUT_MS,
      });
      return 'rolled-back';
    }

    await this.files.apply([rules]);
    return 'applied';
  }

  // nat is shared with Docker (embedded DNS DNAT lives there): the VPN
  // masquerade is appended only when missing, mirroring how the shaper owns
  // its mangle rules.
  async ensureMasquerade(subnet: Cidr): Promise<void> {
    const ruleArgs = [
      'POSTROUTING',
      '-s', subnet.value,
      '!', '-d', subnet.value,
      '-j', 'MASQUERADE',
    ];
    const check = await this.runner.run({
      command: 'iptables',
      args: ['-t', 'nat', '-C', ...ruleArgs],
      timeoutMs: RESTORE_TIMEOUT_MS,
    });
    if (check.exitCode === 0) {
      return;
    }
    await runOrThrow(this.runner, {
      command: 'iptables',
      args: ['-t', 'nat', '-A', ...ruleArgs],
      timeoutMs: RESTORE_TIMEOUT_MS,
    });
  }
}
