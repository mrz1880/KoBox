import { DomainError } from '../shared/DomainError.js';

export class InvalidRemotePortError extends DomainError {
  constructor(raw: number) {
    super(`invalid remote port ${String(raw)}: expected an integer in [1, 65535]`);
  }
}

// The SSH port of the member's own machine. Its own type rather than a number:
// host and port sit next to each other in every signature that reaches ssh, and
// two bare numbers side by side is a swapped-argument bug waiting to happen.
export class RemotePort {
  private declare readonly _brand: 'RemotePort';

  private constructor(readonly value: number) {}

  static parse(raw: number): RemotePort {
    if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
      throw new InvalidRemotePortError(raw);
    }
    return new RemotePort(raw);
  }

  equals(other: RemotePort): boolean {
    return this.value === other.value;
  }
}
