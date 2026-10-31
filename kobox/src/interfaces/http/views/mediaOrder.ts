import type { MediaFile } from '../../../domain/media/MediaFile.js';

export type MediaColumn = 'name' | 'size';
export type SortDirection = 'asc' | 'desc';

const COLUMNS: readonly MediaColumn[] = ['name', 'size'];
const DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

// Release names are Latin script, numbered episodes and years: a numeric,
// case-blind comparison puts E2 before E10 whatever the reader's language.
const BY_NAME = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// the way a column reads first: names A to Z, the biggest files on top
const FIRST_DIRECTION: Record<MediaColumn, SortDirection> = { name: 'asc', size: 'desc' };

const COMPARE: Record<MediaColumn, (a: MediaFile, b: MediaFile) => number> = {
  name: (a, b) => BY_NAME.compare(a.path.name, b.path.name),
  size: (a, b) => a.sizeBytes - b.sizeBytes,
};

// The order a member chose for their media, read back from the page's own
// links. Anything else in the query falls back to the default rather than
// failing: a stale bookmark still opens the page.
export class MediaOrder {
  private constructor(
    readonly column: MediaColumn,
    readonly direction: SortDirection,
  ) {}

  static fromQuery(query: unknown): MediaOrder {
    const { sort, order } = (query ?? {}) as Record<string, unknown>;
    const column = COLUMNS.find((known) => known === sort) ?? 'name';
    const direction = DIRECTIONS.find((known) => known === order) ?? 'asc';
    return new MediaOrder(column, direction);
  }

  sorted(files: readonly MediaFile[]): MediaFile[] {
    const sign = this.direction === 'asc' ? 1 : -1;
    const compare = COMPARE[this.column];
    return [...files].sort((a, b) => sign * compare(a, b));
  }

  // the query a column header links to: the same column turned around, or
  // another one in the way it reads first
  linkFor(column: MediaColumn): string {
    const direction =
      column === this.column ? (this.direction === 'asc' ? 'desc' : 'asc') : FIRST_DIRECTION[column];
    return `sort=${column}&order=${direction}`;
  }
}
