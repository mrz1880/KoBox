import type { UsageCounter, UsageMeterPort } from '../../../domain/security/ports.js';

export class FakeUsageMeter implements UsageMeterPort {
  private readonly counters = new Map<string, UsageCounter>();

  setCounter(username: string, egressBytes: number, ingressBytes: number): void {
    this.counters.set(username, { username, egressBytes, ingressBytes });
  }

  readCounters(): Promise<readonly UsageCounter[]> {
    return Promise.resolve([...this.counters.values()]);
  }
}
