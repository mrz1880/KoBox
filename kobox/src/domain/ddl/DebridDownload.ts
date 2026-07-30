import type { Username } from '../user/Username.js';
import type { DownloadCategory } from './DownloadCategory.js';
import type { DownloadGid } from './DownloadGid.js';
import type { FilehosterLink } from './FilehosterLink.js';

export type DownloadStatus = 'pending' | 'downloading' | 'done' | 'failed';

interface DebridDownloadProps {
  readonly id?: number;
  readonly username: Username;
  readonly category: DownloadCategory;
  readonly sourceLink: FilehosterLink;
  readonly status: DownloadStatus;
  readonly gid?: DownloadGid;
  readonly filename?: string;
  readonly error?: string;
  readonly createdAt: string;
}

// One debrid download request. State machine: pending -> downloading (aria2 gid
// assigned) -> done (file placed in the user home) | failed. Immutable
// transitions; the source link is content, never a secret (the debrid key lives
// only in the worker env).
export class DebridDownload {
  readonly id?: number;
  readonly username: Username;
  readonly category: DownloadCategory;
  readonly sourceLink: FilehosterLink;
  readonly status: DownloadStatus;
  readonly gid?: DownloadGid;
  readonly filename?: string;
  readonly error?: string;
  readonly createdAt: string;

  private constructor(props: DebridDownloadProps) {
    if (props.id !== undefined) {
      this.id = props.id;
    }
    this.username = props.username;
    this.category = props.category;
    this.sourceLink = props.sourceLink;
    this.status = props.status;
    if (props.gid !== undefined) {
      this.gid = props.gid;
    }
    if (props.filename !== undefined) {
      this.filename = props.filename;
    }
    if (props.error !== undefined) {
      this.error = props.error;
    }
    this.createdAt = props.createdAt;
  }

  static request(
    props: Pick<DebridDownloadProps, 'username' | 'category' | 'sourceLink'>,
    now: string,
  ): DebridDownload {
    return new DebridDownload({ ...props, status: 'pending', createdAt: now });
  }

  static restore(props: DebridDownloadProps): DebridDownload {
    return new DebridDownload(props);
  }

  identifiedBy(id: number): DebridDownload {
    return new DebridDownload({ ...this.props(), id });
  }

  startedWith(gid: DownloadGid): DebridDownload {
    return new DebridDownload({ ...this.props(), status: 'downloading', gid });
  }

  completed(filename: string): DebridDownload {
    return new DebridDownload({ ...this.props(), status: 'done', filename });
  }

  failed(error: string): DebridDownload {
    return new DebridDownload({ ...this.props(), status: 'failed', error });
  }

  private props(): DebridDownloadProps {
    return {
      ...(this.id !== undefined && { id: this.id }),
      username: this.username,
      category: this.category,
      sourceLink: this.sourceLink,
      status: this.status,
      ...(this.gid !== undefined && { gid: this.gid }),
      ...(this.filename !== undefined && { filename: this.filename }),
      ...(this.error !== undefined && { error: this.error }),
      createdAt: this.createdAt,
    };
  }
}
