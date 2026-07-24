import type { UsageCounter, UsageMeterPort } from '../../domain/security/ports.js';
import type { CommandRunner } from './CommandRunner.js';

const COUNTER_COMMENT = /\/\* kobox:(egress|ingress):([a-z0-9-]+) \*\//;

// Pure parse of `iptables -nvxL <chain>` output: bytes are column 2, the
// owning user rides in the rule comment.
export function parseMeterCounters(listing: string): ReadonlyMap<string, number> {
  const bytesByUser = new Map<string, number>();
  for (const line of listing.split('\n')) {
    const comment = COUNTER_COMMENT.exec(line);
    const bytes = Number(line.trim().split(/\s+/)[1]);
    const username = comment?.[2];
    if (username !== undefined && Number.isFinite(bytes)) {
      bytesByUser.set(username, (bytesByUser.get(username) ?? 0) + bytes);
    }
  }
  return bytesByUser;
}

// Reads the cumulative per-user byte counters from the two meter chains the
// firewall renders. A missing chain (fresh box, firewall never applied) is
// simply "no data yet", not an error.
export class IptablesUsageMeterAdapter implements UsageMeterPort {
  constructor(private readonly runner: CommandRunner) {}

  async readCounters(): Promise<readonly UsageCounter[]> {
    const egress = await this.listChain('kobox-meter-out');
    const ingress = await this.listChain('kobox-meter-in');

    const usernames = new Set([...egress.keys(), ...ingress.keys()]);
    return [...usernames].sort().map((username) => ({
      username,
      egressBytes: egress.get(username) ?? 0,
      ingressBytes: ingress.get(username) ?? 0,
    }));
  }

  private async listChain(chain: string): Promise<ReadonlyMap<string, number>> {
    const result = await this.runner.run({
      command: 'iptables',
      args: ['-nvxL', chain],
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) {
      return new Map();
    }
    return parseMeterCounters(result.stdout);
  }
}
