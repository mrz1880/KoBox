// Retry ladder for the durable mail outbox (AUDIT §1.7: the legacy `mails`
// queue flushed by SendMails.bsh every 5 minutes, now with typed backoff).
// Index n-1 = delay applied after the nth failed attempt; past the ladder the
// mail is dead (`failed`) and stays visible for the operator.
const BACKOFF_MINUTES: readonly number[] = [5, 30, 120, 720];

export const MAX_MAIL_ATTEMPTS = BACKOFF_MINUTES.length + 1;

export function nextAttemptDelayMinutes(failedAttempts: number): number | undefined {
  if (!Number.isInteger(failedAttempts) || failedAttempts < 1) {
    throw new RangeError(`attempts must be a positive integer, got ${String(failedAttempts)}`);
  }
  return BACKOFF_MINUTES[failedAttempts - 1];
}
