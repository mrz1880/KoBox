import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import type { CertStorePort } from '../../domain/tracker/ports.js';
import type { Logger } from '../logging/logger.js';
import type { CommandRunner } from './CommandRunner.js';

// PEMs land as real files (write-if-changed via ManagedFilesPort), not the
// legacy symlink-into-/opt dance. rehash failures are logged, not thrown:
// the cert on disk is the truth, the hash links are an optimization.
export class CertStoreAdapter implements CertStorePort {
  constructor(
    private readonly files: ManagedFilesPort,
    private readonly runner: CommandRunner,
    private readonly logger: Logger,
    private readonly certsDir = '/etc/ssl/certs',
  ) {}

  async install(host: TrackerHost, pem: string): Promise<void> {
    await this.files.apply([
      {
        path: this.pemPath(host),
        content: pem,
        mode: '0644',
        owner: 'root',
        group: 'root',
      },
    ]);
  }

  remove(host: TrackerHost): Promise<void> {
    const path = this.pemPath(host);
    if (existsSync(path)) {
      unlinkSync(path);
    }
    return Promise.resolve();
  }

  async rehash(): Promise<void> {
    try {
      const result = await this.runner.run({
        command: 'openssl',
        args: ['rehash', this.certsDir],
      });
      if (result.exitCode !== 0) {
        this.logger.warn({ stderr: result.stderr }, 'openssl rehash failed');
      }
    } catch (error) {
      this.logger.warn({ error }, 'openssl rehash failed');
    }
  }

  private pemPath(host: TrackerHost): string {
    return join(this.certsDir, `${host.value}.pem`);
  }
}
