import type { FirewallApplyOutcome, FirewallApplyPort } from '../../../domain/security/ports.js';
import type { RenderedFile } from '../../../domain/shared/files.js';

// Mirrors the real adapter's idempotence: an identical content is 'unchanged'.
export class FakeFirewallApply implements FirewallApplyPort {
  readonly applied: RenderedFile[] = [];
  private lastContent: string | undefined;
  private rollbackNext = false;

  failNextWithRollback(): void {
    this.rollbackNext = true;
  }

  apply(rules: RenderedFile): Promise<FirewallApplyOutcome> {
    this.applied.push(rules);
    if (this.rollbackNext) {
      this.rollbackNext = false;
      return Promise.resolve('rolled-back');
    }
    if (rules.content === this.lastContent) {
      return Promise.resolve('unchanged');
    }
    this.lastContent = rules.content;
    return Promise.resolve('applied');
  }
}
