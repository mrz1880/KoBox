import { DomainError } from '../shared/DomainError.js';

export class InvalidBlocklistSourceError extends DomainError {
  constructor(raw: string) {
    super(`invalid blocklist source ${JSON.stringify(raw)}: must be iblocklist or personal`);
  }
}

export type BlocklistSourceValue = 'iblocklist' | 'personal';

export class BlocklistSource {
  private constructor(readonly value: BlocklistSourceValue) {}

  static parse(raw: string): BlocklistSource {
    if (raw !== 'iblocklist' && raw !== 'personal') {
      throw new InvalidBlocklistSourceError(raw);
    }
    return new BlocklistSource(raw);
  }

  equals(other: BlocklistSource): boolean {
    return this.value === other.value;
  }
}
