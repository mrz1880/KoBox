import { DomainError } from '../shared/DomainError.js';

export class InvalidDownloadProgressError extends DomainError {
  constructor(reason: string) {
    super(`invalid download progress: ${reason}`);
  }
}

// How far along a running download is, when that is genuinely known.
//
// `of` returns undefined rather than zero while the size is unknown: aria2
// reports totalLength 0 until it has the response headers, and drawing 0% then
// says "started, nothing done" when the truth is "we cannot tell yet". A bar
// that lies early is a bar nobody believes later.
export class DownloadProgress {
  private constructor(readonly percent: number) {}

  static of(completedBytes: number, totalBytes: number): DownloadProgress | undefined {
    if (!Number.isFinite(completedBytes) || !Number.isFinite(totalBytes)) {
      throw new InvalidDownloadProgressError('byte counts must be numbers');
    }
    if (totalBytes <= 0) {
      return undefined;
    }
    // aria2 can briefly report a completed length above the total on the last
    // piece, and a 103% bar is how people learn to distrust a bar
    const ratio = Math.min(completedBytes / totalBytes, 1);
    return new DownloadProgress(Math.round(ratio * 100));
  }
}
