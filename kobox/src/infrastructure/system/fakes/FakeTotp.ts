import type { TotpPort } from '../../../domain/portal/ports.js';
import { TotpSecret } from '../../../domain/portal/TotpSecret.js';

// Codes are whatever a test says they are: `accept('123456', 7)` makes that
// code belong to step 7 for any secret, at any time.
export class FakeTotp implements TotpPort {
  private readonly steps = new Map<string, number>();
  private issued = 0;

  accept(code: string, step: number): void {
    this.steps.set(code, step);
  }

  private lastStep = 1000;

  // a code no earlier sign-in used, so replay protection lets it through
  freshCode(): string {
    this.lastStep += 1;
    const code = String(this.lastStep).padStart(6, '0');
    this.accept(code, this.lastStep);
    return code;
  }

  newSecret(): TotpSecret {
    this.issued += 1;
    return TotpSecret.parse(`${'A'.repeat(31)}${String.fromCharCode(65 + this.issued)}`);
  }

  stepOf(_secret: TotpSecret, code: string): number | undefined {
    return this.steps.get(code);
  }
}
