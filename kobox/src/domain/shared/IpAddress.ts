import { DomainError } from './DomainError.js';

export class InvalidIpAddressError extends DomainError {
  constructor(raw: string) {
    super(`invalid IPv4 address ${JSON.stringify(raw)}`);
  }
}

// Strict dotted-quad: no leading zeros (octal ambiguity), no signs, no spaces.
const OCTET = '(0|[1-9][0-9]?|1[0-9][0-9]|2[0-4][0-9]|25[0-5])';
export const IPV4_PATTERN = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

// Ranges a connection from the internet never comes from, as [first octet,
// lowest second octet, highest second octet]: "this network", private
// (RFC 1918), carrier-grade NAT, loopback and link-local. From 224 up
// (multicast, reserved) nothing is either.
const NOT_FROM_INTERNET: readonly (readonly [number, number, number])[] = [
  [0, 0, 255],
  [10, 0, 255],
  [100, 64, 127],
  [127, 0, 255],
  [169, 254, 254],
  [172, 16, 31],
  [192, 168, 168],
];
const FIRST_MULTICAST_OCTET = 224;

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

  get isPublic(): boolean {
    const [first, second] = this.value.split('.').map(Number) as [number, number];
    return (
      first < FIRST_MULTICAST_OCTET &&
      !NOT_FROM_INTERNET.some(
        ([octet, low, high]) => first === octet && second >= low && second <= high,
      )
    );
  }

  equals(other: IpAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
