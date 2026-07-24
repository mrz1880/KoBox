import { DomainError } from '../shared/DomainError.js';

export class InvalidTrackerHostError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid tracker host ${JSON.stringify(raw)}: ${reason}`);
  }
}

// The §5.1 fix: this value reaches openssl as an execFile argv element. The
// charset leaves no room for shell metacharacters, and a leading dash (which
// openssl would read as an option) is unrepresentable.
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class TrackerHost {
  private constructor(readonly value: string) {}

  static parse(raw: string): TrackerHost {
    const normalized = raw.toLowerCase();
    if (normalized.length === 0) {
      throw new InvalidTrackerHostError(raw, 'empty');
    }
    if (normalized.length > 253) {
      throw new InvalidTrackerHostError(raw, 'longer than 253 characters');
    }
    if (!/^[a-z0-9.-]+$/.test(normalized)) {
      throw new InvalidTrackerHostError(raw, 'contains characters unsafe for a shell');
    }
    const labels = normalized.split('.');
    if (labels.length < 2) {
      throw new InvalidTrackerHostError(raw, 'must be a fully qualified name');
    }
    for (const label of labels) {
      if (!LABEL_PATTERN.test(label)) {
        throw new InvalidTrackerHostError(raw, `label ${JSON.stringify(label)} is invalid`);
      }
    }
    return new TrackerHost(normalized);
  }

  get registrableDomain(): string {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(this.value)) {
      return this.value;
    }
    return this.value.split('.').slice(-2).join('.');
  }

  equals(other: TrackerHost): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
