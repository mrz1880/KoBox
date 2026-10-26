import { shiftStamp } from '../shared/stamp.js';
import type { Role } from './Role.js';
// Portal auth policy constants and the expiries they set, as stamps.

export const MAX_LOGIN_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const SESSION_TTL_DAYS = 7;

export function lockExpiry(now: string): string {
  return shiftStamp(now, LOCK_MINUTES * 60_000);
}

export function sessionExpiry(now: string): string {
  return shiftStamp(now, SESSION_TTL_DAYS * 24 * 60 * 60_000);
}

export function isLocked(lockedUntil: string | undefined, now: string): boolean {
  return lockedUntil !== undefined && lockedUntil > now;
}

// An admin account opens every member's settings, so it signs in with a
// two-step code as well as a password; for a member it is their choice.
export function secondStepRequired(role: Role): boolean {
  return role === 'admin';
}
