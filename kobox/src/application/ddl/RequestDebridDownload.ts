import { DebridDownload } from '../../domain/ddl/DebridDownload.js';
import type { DownloadCategory } from '../../domain/ddl/DownloadCategory.js';
import type { FilehosterLink } from '../../domain/ddl/FilehosterLink.js';
import type { DebridDownloadRepository } from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { parseJob } from '../jobs/contract.js';
import type { JobQueuePort } from '../jobs/JobQueuePort.js';

export interface RequestDebridDownloadCommand {
  readonly username: Username;
  readonly category: DownloadCategory;
  readonly link: FilehosterLink;
}

interface Deps {
  readonly repo: DebridDownloadRepository;
  readonly queue: JobQueuePort;
  readonly clock: () => string;
}

// The unprivileged entry point (portal): persists a pending row and enqueues the
// typed job. It never touches the debrid key — resolution happens in the worker.
export class RequestDebridDownload {
  constructor(private readonly deps: Deps) {}

  async execute(command: RequestDebridDownloadCommand): Promise<number> {
    const saved = await this.deps.repo.save(
      DebridDownload.request(
        { username: command.username, category: command.category, sourceLink: command.link },
        this.deps.clock(),
      ),
    );
    if (saved.id === undefined) {
      throw new Error('saved debrid download has no id');
    }
    await this.deps.queue.enqueue(parseJob('debrid-download', { downloadId: saved.id }));
    return saved.id;
  }
}
