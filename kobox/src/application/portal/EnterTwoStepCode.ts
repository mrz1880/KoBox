import { isLocked } from '../../domain/portal/policy.js';
import type {
  LoginAttemptsPort,
  PortalCredentialsPort,
  SessionStorePort,
  SessionTokenPort,
  TotpPort,
} from '../../domain/portal/ports.js';
import { recordLoginFailure } from './loginFailures.js';

export interface EnterTwoStepCodeCommand {
  readonly token: string;
  readonly code: string;
  readonly now: string;
  readonly nowMs: number;
}

export type EnterTwoStepCodeOutcome = 'accepted' | 'wrong-code' | 'locked' | 'no-session';

interface Deps {
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
  readonly attempts: LoginAttemptsPort;
  readonly tokens: SessionTokenPort;
  readonly totp: TotpPort;
}

// The second half of signing in. A code belongs to a 30-second step; one at
// or before the last step accepted is refused, so a code cannot be replayed.
export class EnterTwoStepCode {
  constructor(private readonly deps: Deps) {}

  async execute(command: EnterTwoStepCodeCommand): Promise<EnterTwoStepCodeOutcome> {
    const { credentials, sessions, attempts, tokens, totp } = this.deps;
    const session = await sessions.find(tokens.hashToken(command.token));
    if (session === undefined || !session.awaitingCode || session.expiresAt <= command.now) {
      return 'no-session';
    }
    const attempt = await attempts.get(session.username);
    if (isLocked(attempt?.lockedUntil, command.now)) {
      return 'locked';
    }
    const stored = await credentials.find(session.username);
    const twoStep = stored?.twoStep;
    if (stored === undefined || twoStep === undefined) {
      return 'no-session';
    }
    const step = totp.stepOf(twoStep.secret, command.code, command.nowMs);
    if (step === undefined || step <= (twoStep.lastStep ?? -1)) {
      await recordLoginFailure(attempts, session.username, attempt?.failures ?? 0, command.now);
      return 'wrong-code';
    }
    await credentials.save({ ...stored, twoStep: { ...twoStep, lastStep: step } }, command.now);
    await attempts.clear(session.username);
    await sessions.markCodeEntered(session.id);
    return 'accepted';
  }
}
