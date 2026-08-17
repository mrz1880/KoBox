import { DomainError } from '../shared/DomainError.js';

export const RECYCLING_MODES = ['none', 'copy', 'hardlink'] as const;
export type RecyclingModeValue = (typeof RECYCLING_MODES)[number];

export class InvalidRecyclingModeError extends DomainError {
  constructor(raw: string) {
    super(`invalid recycling mode ${JSON.stringify(raw)}: expected ${RECYCLING_MODES.join('|')}`);
  }
}

// What to do when a member adds a torrent whose content another member already
// has on this box.
//
// `none`  download it again, which is what a seedbox does by default.
// `copy`  copy the files across, trading disk for bandwidth. Each member keeps
//         their own bytes, so quotas keep meaning what they say.
// `hardlink` point at the same inodes. Costs almost no disk and no bandwidth,
//         and breaks what a quota measures: the same blocks are counted once,
//         for whoever the filesystem happens to attribute them to. Removing one
//         member's copy frees nothing while another still links to it.
//
// The third is a real trade, not a better version of the second, which is why
// it is named separately and never the default.
export class RecyclingMode {
  private constructor(readonly value: RecyclingModeValue) {}

  static readonly none = new RecyclingMode('none');
  static readonly copy = new RecyclingMode('copy');
  static readonly hardlink = new RecyclingMode('hardlink');

  static parse(raw: string): RecyclingMode {
    switch (raw) {
      case 'none':
        return RecyclingMode.none;
      case 'copy':
        return RecyclingMode.copy;
      case 'hardlink':
        return RecyclingMode.hardlink;
      default:
        throw new InvalidRecyclingModeError(raw);
    }
  }

  get reusesExistingContent(): boolean {
    return this.value !== 'none';
  }

  get sharesInodes(): boolean {
    return this.value === 'hardlink';
  }

  equals(other: RecyclingMode): boolean {
    return this.value === other.value;
  }
}
