// Portal auth policy constants and pure timestamp helpers. Timestamps follow
// the codebase-wide 'YYYY-MM-DD HH:MM:SS' UTC convention (lexicographically
// ordered, so string comparison is chronological comparison).

export const MAX_LOGIN_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const SESSION_TTL_DAYS = 7;

function shift(now: string, milliseconds: number): string {
  const date = new Date(`${now.replace(' ', 'T')}Z`);
  return new Date(date.getTime() + milliseconds).toISOString().slice(0, 19).replace('T', ' ');
}

export function lockExpiry(now: string): string {
  return shift(now, LOCK_MINUTES * 60_000);
}

export function sessionExpiry(now: string): string {
  return shift(now, SESSION_TTL_DAYS * 24 * 60 * 60_000);
}

export function isLocked(lockedUntil: string | undefined, now: string): boolean {
  return lockedUntil !== undefined && lockedUntil > now;
}
