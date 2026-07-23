import { Quota } from '../../../domain/user/Quota.js';
import type { QuotaPort } from '../../../domain/user/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeQuota implements QuotaPort {
  private readonly quotas = new Map<string, Quota>();
  private readonly usages = new Map<string, Quota>();

  setQuota(username: Username, quota: Quota): Promise<void> {
    this.quotas.set(username.value, quota);
    return Promise.resolve();
  }

  getUsage(username: Username): Promise<Quota> {
    return Promise.resolve(this.usages.get(username.value) ?? Quota.bytes(0));
  }

  quotaOf(username: Username): Quota | undefined {
    return this.quotas.get(username.value);
  }

  setUsageForTest(username: Username, usage: Quota): void {
    this.usages.set(username.value, usage);
  }

  clearFor(username: Username): void {
    this.quotas.delete(username.value);
    this.usages.delete(username.value);
  }
}
