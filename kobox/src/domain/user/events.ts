export interface UserCreated {
  readonly type: 'UserCreated';
  readonly username: string;
}

export interface UserDeleted {
  readonly type: 'UserDeleted';
  readonly username: string;
}

export interface PasswordChanged {
  readonly type: 'PasswordChanged';
  readonly username: string;
}

export interface UserSuspended {
  readonly type: 'UserSuspended';
  readonly username: string;
}

export interface UserResumed {
  readonly type: 'UserResumed';
  readonly username: string;
}

// A member asked for a new password from the sign-in page; the link went out.
export interface PasswordResetRequested {
  readonly type: 'PasswordResetRequested';
  readonly username: string;
}

export type UserEvent =
  | UserCreated
  | UserDeleted
  | PasswordChanged
  | UserSuspended
  | UserResumed
  | PasswordResetRequested;

// Who joins, who leaves, who asked for a new password: every admin hears of
// those, not only whoever set the box's alert address up. The rest follows from
// an admin's own action, or is the operator's to watch.
const EVERY_ADMIN: ReadonlySet<string> = new Set<UserEvent['type']>([
  'UserCreated',
  'UserDeleted',
  'PasswordResetRequested',
]);

// Takes any event: one from another context is simply not an account event.
export function concernsEveryAdmin(event: { readonly type: string }): boolean {
  return EVERY_ADMIN.has(event.type);
}
