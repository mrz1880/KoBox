import type { FileIndexPort } from '../../../domain/torrent/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeFileIndex implements FileIndexPort {
  readonly refreshed: string[] = [];

  refresh(username: Username): Promise<void> {
    this.refreshed.push(username.value);
    return Promise.resolve();
  }
}
