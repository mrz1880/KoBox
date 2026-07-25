import { DomainError } from '../shared/DomainError.js';

export class InvalidRoleError extends DomainError {
  constructor(raw: string) {
    super(`invalid portal role ${JSON.stringify(raw)}`);
  }
}

export const ROLES = ['admin', 'user'] as const;

// Closed set: the portal knows exactly two capability levels. `admin` sees the
// fleet and enqueues privileged intents; `user` sees and manages only itself.
export type Role = (typeof ROLES)[number];

export function parseRole(raw: string): Role {
  const match = ROLES.find((role) => role === raw);
  if (match === undefined) {
    throw new InvalidRoleError(raw);
  }
  return match;
}
