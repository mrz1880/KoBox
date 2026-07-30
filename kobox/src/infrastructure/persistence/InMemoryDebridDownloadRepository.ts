import type { DebridDownload } from '../../domain/ddl/DebridDownload.js';
import type { DebridDownloadRepository } from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryDebridDownloadRepository implements DebridDownloadRepository {
  private readonly rows = new Map<number, DebridDownload>();
  private seq = 0;

  save(download: DebridDownload): Promise<DebridDownload> {
    const saved = download.id !== undefined ? download : download.identifiedBy((this.seq += 1));
    this.rows.set(saved.id ?? 0, saved);
    return Promise.resolve(saved);
  }

  findById(id: number): Promise<DebridDownload | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  listActive(): Promise<readonly DebridDownload[]> {
    return Promise.resolve([...this.rows.values()].filter((d) => d.status === 'downloading'));
  }

  listForUser(username: Username): Promise<readonly DebridDownload[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((d) => d.username.value === username.value),
    );
  }
}
