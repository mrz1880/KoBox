import { DomainError } from '../shared/DomainError.js';

export class InvalidTrackerPrivacyError extends DomainError {
  constructor(raw: string) {
    super(`invalid tracker privacy ${JSON.stringify(raw)}: must be public or private`);
  }
}

export type TrackerPrivacyValue = 'public' | 'private';

export class TrackerPrivacy {
  private constructor(readonly value: TrackerPrivacyValue) {}

  static parse(raw: string): TrackerPrivacy {
    if (raw !== 'public' && raw !== 'private') {
      throw new InvalidTrackerPrivacyError(raw);
    }
    return new TrackerPrivacy(raw);
  }

  equals(other: TrackerPrivacy): boolean {
    return this.value === other.value;
  }
}
