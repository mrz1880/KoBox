import { MediaFile, type MediaPath } from '../../domain/media/MediaFile.js';
import type { MediaEntry, MediaRepository } from '../../domain/media/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryMediaRepository implements MediaRepository {
  private readonly byUser = new Map<string, MediaFile[]>();
  private seq = 0;

  replaceFor(username: Username, entries: readonly MediaEntry[], now: string): Promise<void> {
    this.byUser.set(
      username.value,
      entries.map((entry) =>
        MediaFile.record({
          id: (this.seq += 1),
          username,
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          indexedAt: now,
        }),
      ),
    );
    return Promise.resolve();
  }

  listFor(username: Username): Promise<readonly MediaFile[]> {
    return Promise.resolve(this.byUser.get(username.value) ?? []);
  }

  find(username: Username, path: MediaPath): Promise<MediaFile | undefined> {
    return Promise.resolve(
      (this.byUser.get(username.value) ?? []).find((file) => file.path.value === path.value),
    );
  }

  removeFor(username: Username): Promise<void> {
    this.byUser.delete(username.value);
    return Promise.resolve();
  }
}
