import type { QuotaGaugePort } from '../../../domain/user/ports.js';
import type { Quota } from '../../../domain/user/Quota.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeQuotaGauges implements QuotaGaugePort {
  readonly shown: { username: string; usedGib: number; quotaGib: number }[] = [];

  show(username: Username, used: Quota, quota: Quota): Promise<void> {
    this.shown.push({ username: username.value, usedGib: used.toGib(), quotaGib: quota.toGib() });
    return Promise.resolve();
  }
}
