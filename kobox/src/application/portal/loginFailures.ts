import { lockExpiry, MAX_LOGIN_FAILURES } from '../../domain/portal/policy.js';
import type { LoginAttemptsPort } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';

// One count for a wrong password and a wrong two-step code alike: the lockout
// bounds guessing either.
export async function recordLoginFailure(
  attempts: LoginAttemptsPort,
  username: Username,
  failuresSoFar: number,
  now: string,
): Promise<void> {
  const next = failuresSoFar + 1;
  await attempts.save({
    username,
    failures: next,
    ...(next >= MAX_LOGIN_FAILURES && { lockedUntil: lockExpiry(now) }),
  });
}
