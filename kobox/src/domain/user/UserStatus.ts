import { DomainError } from '../shared/DomainError.js';

export class InvalidUserStatusError extends DomainError {
  constructor(raw: string) {
    super(`invalid user status ${JSON.stringify(raw)}: expected active|suspended`);
  }
}

export class UserStatus {
  static readonly active = new UserStatus('active');
  static readonly suspended = new UserStatus('suspended');

  private constructor(readonly value: 'active' | 'suspended') {}

  static parse(raw: string): UserStatus {
    switch (raw) {
      case 'active':
        return UserStatus.active;
      case 'suspended':
        return UserStatus.suspended;
      default:
        throw new InvalidUserStatusError(raw);
    }
  }

  isSuspended(): boolean {
    return this === UserStatus.suspended;
  }

  toString(): string {
    return this.value;
  }
}
