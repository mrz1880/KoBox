import { DomainError } from './DomainError.js';

export class InvalidIpAddressError extends DomainError {
  constructor(raw: string) {
    super(`invalid IPv4 address ${JSON.stringify(raw)}`);
  }
}

// Strict dotted-quad: no leading zeros (octal ambiguity), no signs, no spaces.
const OCTET = '(0|[1-9][0-9]?|1[0-9][0-9]|2[0-4][0-9]|25[0-5])';
export const IPV4_PATTERN = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

export class IpAddress {
  private constructor(readonly value: string) {}

  static parse(raw: string): IpAddress {
    if (!IPV4_PATTERN.test(raw)) {
      throw new InvalidIpAddressError(raw);
    }
    return new IpAddress(raw);
  }

  // The legacy tracker pipeline skips these two placeholder answers.
  get isUsable(): boolean {
    return this.value !== '127.0.0.1' && this.value !== '0.0.0.0';
  }

  equals(other: IpAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
