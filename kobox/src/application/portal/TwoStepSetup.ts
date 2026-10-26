import type { PortalCredentialsPort, TotpPort } from '../../domain/portal/ports.js';
import type { TotpSecret } from '../../domain/portal/TotpSecret.js';
import { withoutCredential } from '../../domain/portal/credentials.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly credentials: PortalCredentialsPort;
  readonly totp: TotpPort;
}

interface CodeCommand {
  readonly username: Username;
  readonly code: string;
  readonly now: string;
  readonly nowMs: number;
}

// A member turns two-step sign-in on from their own account: a secret is shown
// once, and only a first code from their app proves it was written down. Off
// takes a current code, so a stolen session alone cannot remove it.
export class TwoStepSetup {
  constructor(private readonly deps: Deps) {}

  async begin(username: Username, now: string): Promise<TotpSecret | undefined> {
    const stored = await this.deps.credentials.find(username);
    if (stored === undefined) {
      return undefined;
    }
    const secret = this.deps.totp.newSecret();
    await this.deps.credentials.save({ ...stored, twoStepPending: secret }, now);
    return secret;
  }

  async confirm(command: CodeCommand): Promise<boolean> {
    const stored = await this.deps.credentials.find(command.username);
    const pending = stored?.twoStepPending;
    if (stored === undefined || pending === undefined) {
      return false;
    }
    const step = this.deps.totp.stepOf(pending, command.code, command.nowMs);
    if (step === undefined) {
      return false;
    }
    await this.deps.credentials.save(
      { ...withoutCredential(stored, 'twoStepPending'), twoStep: { secret: pending, lastStep: step } },
      command.now,
    );
    return true;
  }

  async turnOff(command: CodeCommand): Promise<boolean> {
    const stored = await this.deps.credentials.find(command.username);
    const twoStep = stored?.twoStep;
    if (stored === undefined || twoStep === undefined) {
      return false;
    }
    const step = this.deps.totp.stepOf(twoStep.secret, command.code, command.nowMs);
    if (step === undefined || step <= (twoStep.lastStep ?? -1)) {
      return false;
    }
    await this.deps.credentials.save(withoutCredential(stored, 'twoStep'), command.now);
    return true;
  }

  // root's way back in for a member who lost their phone: no code asked
  async reset(username: Username, now: string): Promise<boolean> {
    const stored = await this.deps.credentials.find(username);
    if (stored === undefined) {
      return false;
    }
    await this.deps.credentials.save(withoutCredential(stored, 'twoStep', 'twoStepPending'), now);
    return true;
  }
}
