import { DomainError } from '../shared/DomainError.js';

export class InvalidAccountTypeError extends DomainError {
  constructor(raw: string) {
    super(`invalid account type ${JSON.stringify(raw)}: expected normal|plex`);
  }
}

export class AccountType {
  static readonly normal = new AccountType('normal');
  static readonly plex = new AccountType('plex');

  private constructor(readonly value: 'normal' | 'plex') {}

  static parse(raw: string): AccountType {
    switch (raw) {
      case 'normal':
        return AccountType.normal;
      case 'plex':
        return AccountType.plex;
      default:
        throw new InvalidAccountTypeError(raw);
    }
  }

  toString(): string {
    return this.value;
  }
}
