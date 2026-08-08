import type { MediaRepository, MediaScanPort } from '../../domain/media/ports.js';
import type { UserRepository } from '../../domain/user/ports.js';

interface Deps {
  readonly users: UserRepository;
  readonly scanner: MediaScanPort;
  readonly repo: MediaRepository;
  readonly clock: () => string;
}

// Refreshes what each user has in their completed downloads. Runs worker-side,
// where the filesystem is reachable; the portal only ever reads the resulting
// rows. One user's unreadable home must not stop the others, so each is
// isolated — a home that cannot be scanned simply keeps its previous listing.
export class IndexUserMedia {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    for (const user of await this.deps.users.listAll()) {
      if (user.status.isSuspended()) {
        continue;
      }
      try {
        const entries = await this.deps.scanner.scan(user.username);
        await this.deps.repo.replaceFor(user.username, entries, this.deps.clock());
      } catch {
        // keep the previous listing rather than blanking it on a transient error
        continue;
      }
    }
  }
}
