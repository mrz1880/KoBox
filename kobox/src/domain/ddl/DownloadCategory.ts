import { DomainError } from '../shared/DomainError.js';

export type DownloadCategoryValue = 'films' | 'series';

export class InvalidDownloadCategoryError extends DomainError {
  constructor(raw: string) {
    super(`invalid download category ${JSON.stringify(raw)}: expected films|series`);
  }
}

// Routes a finished download to the right complete/ subdir under the user home,
// the same layout Radarr/Sonarr import from (parity with the torrent path). The
// closed enum keeps the value path-safe by construction.
export class DownloadCategory {
  private constructor(readonly value: DownloadCategoryValue) {}

  static readonly films = new DownloadCategory('films');
  static readonly series = new DownloadCategory('series');

  static parse(raw: string): DownloadCategory {
    switch (raw) {
      case 'films':
        return DownloadCategory.films;
      case 'series':
        return DownloadCategory.series;
      default:
        throw new InvalidDownloadCategoryError(raw);
    }
  }

  get subdir(): string {
    return this.value;
  }
}
