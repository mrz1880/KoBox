import { DomainError } from '../shared/DomainError.js';

export class InvalidCheckStateError extends DomainError {
  constructor(raw: string) {
    super(`invalid check state ${JSON.stringify(raw)}: must be none, pending or checking`);
  }
}

export type CheckStateValue = 'none' | 'pending' | 'checking';

// Legacy trackers_list.to_check mapping: 0 = none, 1 = pending, 3 = checking
// (the in-flight lock). There is no legacy value 2.
const LEGACY_MAP: Record<number, CheckStateValue> = { 0: 'none', 1: 'pending', 3: 'checking' };

export class CheckState {
  private constructor(readonly value: CheckStateValue) {}

  static parse(raw: string): CheckState {
    if (raw !== 'none' && raw !== 'pending' && raw !== 'checking') {
      throw new InvalidCheckStateError(raw);
    }
    return new CheckState(raw);
  }

  static fromLegacy(raw: number): CheckState {
    const value = LEGACY_MAP[raw];
    if (value === undefined) {
      throw new InvalidCheckStateError(String(raw));
    }
    return new CheckState(value);
  }

  equals(other: CheckState): boolean {
    return this.value === other.value;
  }
}
