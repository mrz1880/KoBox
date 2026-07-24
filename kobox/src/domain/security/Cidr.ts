import { DomainError } from '../shared/DomainError.js';
import { IPV4_PATTERN, IpAddress } from '../shared/IpAddress.js';

export class InvalidCidrError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid CIDR ${JSON.stringify(raw)}: ${reason}`);
  }
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

// Canonical only (host bits must be zero): a CIDR is parsed, not repaired —
// "192.0.2.1/24" is a typo we refuse to guess about.
export class Cidr {
  private constructor(
    readonly value: string,
    private readonly network: number,
    private readonly mask: number,
  ) {}

  static parse(raw: string): Cidr {
    const match = /^([0-9.]+)\/(0|[1-9][0-9]?)$/.exec(raw);
    if (!match) {
      throw new InvalidCidrError(raw, 'expected a.b.c.d/prefix');
    }
    const [, address, prefixRaw] = match;
    if (address === undefined || prefixRaw === undefined || !IPV4_PATTERN.test(address)) {
      throw new InvalidCidrError(raw, 'invalid IPv4 network address');
    }
    const prefix = Number(prefixRaw);
    if (prefix > 32) {
      throw new InvalidCidrError(raw, 'prefix must be 0-32');
    }
    const mask = maskOf(prefix);
    const network = ipToInt(address);
    if (((network & mask) >>> 0) !== network) {
      throw new InvalidCidrError(raw, 'host bits set — not a canonical network address');
    }
    return new Cidr(`${address}/${String(prefix)}`, network, mask);
  }

  static host(ip: IpAddress): Cidr {
    return new Cidr(`${ip.value}/32`, ipToInt(ip.value), maskOf(32));
  }

  contains(ip: IpAddress): boolean {
    return ((ipToInt(ip.value) & this.mask) >>> 0) === this.network;
  }

  equals(other: Cidr): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
