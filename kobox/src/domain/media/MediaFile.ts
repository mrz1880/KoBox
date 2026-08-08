import { DomainError } from '../shared/DomainError.js';
import type { Username } from '../user/Username.js';

export class InvalidMediaPathError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid media path ${JSON.stringify(raw)}: ${reason}`);
  }
}

// A path RELATIVE to the user's completed-downloads directory. It is the only
// thing the browser ever sends back, so it is validated as a value: no absolute
// path, no traversal, no NUL. A file outside the user's own tree is therefore
// unreachable by construction rather than by a check someone might forget.
export class MediaPath {
  private constructor(readonly value: string) {}

  static parse(raw: string): MediaPath {
    if (raw === '' || raw.length > 1024) {
      throw new InvalidMediaPathError(raw, 'empty or too long');
    }
    if (raw.startsWith('/')) {
      throw new InvalidMediaPathError(raw, 'must be relative');
    }
    if (raw.includes('\0')) {
      throw new InvalidMediaPathError(raw, 'contains a NUL byte');
    }
    if (raw.split('/').some((segment) => segment === '..' || segment === '.')) {
      throw new InvalidMediaPathError(raw, 'must not traverse');
    }
    return new MediaPath(raw);
  }

  get name(): string {
    return this.value.split('/').pop() ?? this.value;
  }

  // the leading directory doubles as the category the file landed in
  get category(): string {
    const [first, ...rest] = this.value.split('/');
    return rest.length === 0 ? '' : (first ?? '');
  }
}

interface MediaFileProps {
  readonly id?: number;
  readonly username: Username;
  readonly path: MediaPath;
  readonly sizeBytes: number;
  readonly indexedAt: string;
}

// One file the worker saw in a user's completed downloads. The portal reads
// these rows instead of the filesystem, which is what lets it keep no disk
// access at all (ProtectHome=yes stays on).
export class MediaFile {
  readonly id?: number;
  readonly username: Username;
  readonly path: MediaPath;
  readonly sizeBytes: number;
  readonly indexedAt: string;

  private constructor(props: MediaFileProps) {
    if (props.id !== undefined) {
      this.id = props.id;
    }
    this.username = props.username;
    this.path = props.path;
    this.sizeBytes = props.sizeBytes;
    this.indexedAt = props.indexedAt;
  }

  static record(props: MediaFileProps): MediaFile {
    return new MediaFile(props);
  }

  // Browsers play a container they understand; the rest is offered as a
  // download instead of a player that would simply show a black rectangle.
  get isBrowserPlayable(): boolean {
    return ['mp4', 'm4v', 'webm', 'ogg', 'ogv'].includes(this.extension);
  }

  get extension(): string {
    const dot = this.path.name.lastIndexOf('.');
    return dot === -1 ? '' : this.path.name.slice(dot + 1).toLowerCase();
  }
}
