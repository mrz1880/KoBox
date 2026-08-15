import { DomainError } from '../shared/DomainError.js';

export class InvalidLoneFilePlacementError extends DomainError {
  constructor(raw: string) {
    super(`invalid placement ${JSON.stringify(raw)}`);
  }
}

export type LoneFilePlacementValue = 'beside-the-others' | 'in-its-own-folder';

// Where a download that is a single file lands. A torrent that produced a whole
// directory keeps its directory either way; this only decides the lone-file case.
//
// The legacy stored `create_subdir` as 0 or 1, which says nothing about which
// is which at the call site. Naming both sides is the point: Plex and the *arr
// scrapers want one folder per film, and a member who does not use them wants
// the file where they can see it.
export class LoneFilePlacement {
  static readonly besideTheOthers = new LoneFilePlacement('beside-the-others');
  static readonly inItsOwnFolder = new LoneFilePlacement('in-its-own-folder');

  private constructor(readonly value: LoneFilePlacementValue) {}

  static all(): readonly LoneFilePlacement[] {
    return [LoneFilePlacement.besideTheOthers, LoneFilePlacement.inItsOwnFolder];
  }

  static parse(raw: string): LoneFilePlacement {
    const found = LoneFilePlacement.all().find((placement) => placement.value === raw);
    if (found === undefined) {
      throw new InvalidLoneFilePlacementError(raw);
    }
    return found;
  }

  get needsItsOwnFolder(): boolean {
    return this === LoneFilePlacement.inItsOwnFolder;
  }

  equals(other: LoneFilePlacement): boolean {
    return this.value === other.value;
  }
}
