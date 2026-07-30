import type { Username } from '../user/Username.js';
import type { DebridDownload } from './DebridDownload.js';

export interface DebridDownloadRepository {
  // insert when the download has no id (returns it identified), update otherwise
  save(download: DebridDownload): Promise<DebridDownload>;
  findById(id: number): Promise<DebridDownload | undefined>;
  // the poll loop's work list: everything still downloading
  listActive(): Promise<readonly DebridDownload[]>;
  listForUser(username: Username): Promise<readonly DebridDownload[]>;
}
