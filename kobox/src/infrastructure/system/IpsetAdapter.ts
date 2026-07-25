import type { IpsetPort } from '../../domain/tracker/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const IPSET_TIMEOUT_MS = 60_000;

// Real ipset. ensureBlocklistSet answers false (never throws) when the host
// cannot do ipset at all — missing binary or kernel without ip_set — so the
// firewall renders a loadable ruleset anyway (honest degradation, same
// pattern as the dnscrypt fallback).
export class IpsetAdapter implements IpsetPort {
  constructor(private readonly runner: CommandRunner) {}

  async ensureBlocklistSet(): Promise<boolean> {
    const result = await this.runner.run({
      command: 'ipset',
      args: ['create', 'kobox-bl', 'hash:net', 'family', 'inet', 'maxelem', '1048576', '-exist'],
      timeoutMs: IPSET_TIMEOUT_MS,
    });
    return result.exitCode === 0;
  }

  async restore(filePath: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'ipset',
      args: ['restore', '-exist', '-file', filePath],
      timeoutMs: IPSET_TIMEOUT_MS,
    });
  }
}
