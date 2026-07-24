import { readFile } from 'node:fs/promises';
import type { FirewallApplyOutcome, FirewallApplyPort } from '../../domain/security/ports.js';
import type { ManagedFilesPort, RenderedFile } from '../../domain/shared/files.js';
import type { HealthProbePort } from '../../domain/user/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const RESTORE_TIMEOUT_MS = 10_000;

// The anti-lockout guard. Ordering is the whole point:
//   1. read the persisted ruleset — identical content means nothing to do
//      (the file always describes the LIVE ruleset, see below);
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
    if (current === rules.content) {
      return 'unchanged';
    }

    const snapshot = await runOrThrow(this.runner, {
      command: 'iptables-save',
      args: [],
      timeoutMs: RESTORE_TIMEOUT_MS,
    });
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
}
