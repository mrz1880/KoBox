import type { RutorrentProfilePort } from '../../../domain/torrent/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeRutorrentProfiles implements RutorrentProfilePort {
  readonly ensured: string[] = [];

  ensureProfile(username: Username): Promise<void> {
    this.ensured.push(username.value);
    return Promise.resolve();
  }
}
