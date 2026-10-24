import { DomainError } from '../shared/DomainError.js';

// .1 is the box's own end of each tunnel and .255 the broadcast of the /24.
const FIRST = 2;
const LAST = 254;

export class InvalidVpnHostError extends DomainError {
  constructor(raw: number) {
    super(`invalid VPN host ${String(raw)}: expected an integer from ${String(FIRST)} to ${String(LAST)}`);
  }
}

export class VpnAddressesExhaustedError extends DomainError {
  constructor() {
    super('every VPN address is taken: no member can be added to the tunnels');
  }
}

// A member's place in the tunnels: the same host number in each of them, so
// their NAS is 10.0.0.N, 10.0.1.N or 10.0.2.N whichever tunnel it uses. It is
// handed out once, when the account is created, and kept for life: the NFS
// export trusts that address and nothing else.
export class VpnHost {
  private constructor(readonly value: number) {}

  static parse(raw: number): VpnHost {
    if (!Number.isInteger(raw) || raw < FIRST || raw > LAST) {
      throw new InvalidVpnHostError(raw);
    }
    return new VpnHost(raw);
  }

  static lowestFree(taken: readonly VpnHost[]): VpnHost {
    const held = new Set(taken.map((host) => host.value));
    for (let candidate = FIRST; candidate <= LAST; candidate += 1) {
      if (!held.has(candidate)) {
        return new VpnHost(candidate);
      }
    }
    throw new VpnAddressesExhaustedError();
  }

  equals(other: VpnHost): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
