import { DomainError } from '../shared/DomainError.js';
import type { BlocklistSource } from './BlocklistSource.js';
import type { BlocklistUrl } from './BlocklistUrl.js';

export class InvalidBlocklistError extends DomainError {
  constructor(reason: string) {
    super(`invalid blocklist: ${reason}`);
  }
}

// Tagged instead of the legacy magic string 'failed' in a datetime column.
export type BlocklistUpdate =
  | { readonly status: 'ok'; readonly at: string }
  | { readonly status: 'failed' };

interface BlocklistProps {
  readonly source: BlocklistSource;
  readonly author: string;
  readonly name: string;
  readonly url: BlocklistUrl;
  readonly subscription: boolean;
  readonly enabled: boolean;
  readonly lastUpdate?: BlocklistUpdate;
  readonly sha256?: string;
}

export class Blocklist {
  readonly source: BlocklistSource;
  readonly author: string;
  readonly name: string;
  readonly url: BlocklistUrl;
  readonly subscription: boolean;
  readonly enabled: boolean;
  readonly lastUpdate?: BlocklistUpdate;
  readonly sha256?: string;

  private constructor(props: BlocklistProps) {
    this.source = props.source;
    this.author = props.author;
    this.name = props.name;
    this.url = props.url;
    this.subscription = props.subscription;
    this.enabled = props.enabled;
    if (props.lastUpdate !== undefined) {
      this.lastUpdate = props.lastUpdate;
    }
    if (props.sha256 !== undefined) {
      this.sha256 = props.sha256;
    }
  }

  static create(props: Omit<BlocklistProps, 'lastUpdate' | 'sha256'>): Blocklist {
    if (props.name.trim() === '') {
      throw new InvalidBlocklistError('name must not be empty');
    }
    return new Blocklist(props);
  }

  static restore(props: BlocklistProps): Blocklist {
    return new Blocklist(props);
  }

  recordSuccess(at: string, sha256: string): Blocklist {
    return new Blocklist({ ...this.props(), lastUpdate: { status: 'ok', at }, sha256 });
  }

  // Keeps the previous sha256: the last good data stays usable (issue #117).
  recordFailure(): Blocklist {
    return new Blocklist({ ...this.props(), lastUpdate: { status: 'failed' } });
  }

  enable(): Blocklist {
    return this.enabled ? this : new Blocklist({ ...this.props(), enabled: true });
  }

  disable(): Blocklist {
    return this.enabled ? new Blocklist({ ...this.props(), enabled: false }) : this;
  }

  // Legacy file naming: "<author>#<name>" with spaces flattened.
  get fileStem(): string {
    return `${this.author.replaceAll(' ', '_')}#${this.name.replaceAll(' ', '_')}`;
  }

  private props(): BlocklistProps {
    return {
      source: this.source,
      author: this.author,
      name: this.name,
      url: this.url,
      subscription: this.subscription,
      enabled: this.enabled,
      ...(this.lastUpdate !== undefined && { lastUpdate: this.lastUpdate }),
      ...(this.sha256 !== undefined && { sha256: this.sha256 }),
    };
  }
}
