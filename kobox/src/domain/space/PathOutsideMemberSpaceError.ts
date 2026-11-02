import { DomainError } from '../shared/DomainError.js';

// A torrent's data may only be erased from the member's own downloads: a path
// elsewhere (another member, the system, the downloads folder itself) is never
// removed, whatever rTorrent reported.
export class PathOutsideMemberSpaceError extends DomainError {
  constructor(path: string) {
    super(`${path} is outside the member's downloads`);
  }
}
