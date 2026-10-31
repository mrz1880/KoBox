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
