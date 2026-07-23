import { DomainError } from '../shared/DomainError.js';

export class InvalidPortError extends DomainError {
  constructor(raw: number) {
    super(`invalid port ${String(raw)}: expected an integer in [1, 65535]`);
  }
}

function parsePortNumber(raw: number): number {
  if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
    throw new InvalidPortError(raw);
  }
  return raw;
}

export class ScgiPort {
  private declare readonly _brand: 'ScgiPort';

  private constructor(readonly value: number) {}

  static parse(raw: number): ScgiPort {
    return new ScgiPort(parsePortNumber(raw));
  }

  equals(other: ScgiPort): boolean {
    return this.value === other.value;
  }
}

export class RtorrentPort {
  private declare readonly _brand: 'RtorrentPort';

  private constructor(readonly value: number) {}

  static parse(raw: number): RtorrentPort {
    return new RtorrentPort(parsePortNumber(raw));
  }

  equals(other: RtorrentPort): boolean {
    return this.value === other.value;
  }
}

export class ProxyPort {
  private declare readonly _brand: 'ProxyPort';

  private constructor(readonly value: number) {}

  static parse(raw: number): ProxyPort {
    return new ProxyPort(parsePortNumber(raw));
  }

  equals(other: ProxyPort): boolean {
    return this.value === other.value;
  }
}
