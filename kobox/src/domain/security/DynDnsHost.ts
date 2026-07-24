import { DomainError } from '../shared/DomainError.js';

export class InvalidDynDnsHostError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid dyndns host ${JSON.stringify(raw)}: ${reason}`);
  }
}

const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Same shell-safe construction as TrackerHost, with one deliberate difference:
// an IPv4 literal is rejected — a dynamic-DNS entry that never changes is a
// static address and belongs in the ipv4 flavor of user_addresses.
export class DynDnsHost {
  private constructor(readonly value: string) {}

  static parse(raw: string): DynDnsHost {
    const normalized = raw.toLowerCase();
    if (normalized.length === 0) {
      throw new InvalidDynDnsHostError(raw, 'empty');
    }
    if (normalized.length > 253) {
      throw new InvalidDynDnsHostError(raw, 'longer than 253 characters');
    }
    if (!/^[a-z0-9.-]+$/.test(normalized)) {
      throw new InvalidDynDnsHostError(raw, 'contains characters unsafe for a shell');
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
      throw new InvalidDynDnsHostError(raw, 'IPv4 literal — use a static address instead');
    }
    const labels = normalized.split('.');
    if (labels.length < 2) {
      throw new InvalidDynDnsHostError(raw, 'must be a fully qualified name');
    }
    for (const label of labels) {
      if (!LABEL_PATTERN.test(label)) {
        throw new InvalidDynDnsHostError(raw, `label ${JSON.stringify(label)} is invalid`);
      }
    }
    return new DynDnsHost(normalized);
  }

  equals(other: DynDnsHost): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
