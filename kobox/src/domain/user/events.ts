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

export type UserEvent = UserCreated | UserDeleted | PasswordChanged | UserSuspended | UserResumed;
