import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, chmod, readFile, rm, writeFile } from 'node:fs/promises';
import type { InstallHostPort } from '../../domain/installation/ports.js';
import type { RenderedFile } from '../../domain/shared/files.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const HOST_TIMEOUT_MS = 120_000;

// The install-time grab bag of host mutations, kept argv-only or plain fs.
// Ownership of ensureFile targets is left to root:root on purpose in the fs
// fallback — the container/E2E path; chown happens via the rendered mode.
export class InstallHostAdapter implements InstallHostPort {
  constructor(private readonly runner: CommandRunner) {}

  hostname(): Promise<string> {
    return Promise.resolve(hostname());
  }

  pathExists(path: string): Promise<boolean> {
    return Promise.resolve(existsSync(path));
  }

  readFile(path: string): Promise<string | undefined> {
    return readFile(path, 'utf8').then(
      (content) => content,
      () => undefined,
    );
  }

  async removeFile(path: string): Promise<void> {
    await rm(path, { force: true });
  }

  async ensureDir(path: string, mode: string): Promise<void> {
    await mkdir(path, { recursive: true });
    await chmod(path, parseInt(mode, 8));
  }

  async ensureFile(file: RenderedFile): Promise<boolean> {
    if (existsSync(file.path)) {
      return false;
    }
    await mkdir(file.path.slice(0, file.path.lastIndexOf('/')), { recursive: true });
    await writeFile(file.path, file.content, { mode: parseInt(file.mode, 8) });
    await this.chownIfPossible(file);
    return true;
  }

  async extractTarGz(archive: string, destDir: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'tar',
      args: ['-xzf', archive, '-C', destDir, '--strip-components=1'],
      timeoutMs: HOST_TIMEOUT_MS,
    });
  }

  async applySysctl(): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'sysctl',
      args: ['--system'],
      timeoutMs: HOST_TIMEOUT_MS,
    });
  }

  async postconf(settings: Readonly<Record<string, string>>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await runOrThrow(this.runner, {
        command: 'postconf',
        args: ['-e', `${key}=${value}`],
        timeoutMs: HOST_TIMEOUT_MS,
      });
    }
  }

  async preseedDebconf(selections: readonly string[]): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'debconf-set-selections',
      args: [],
      stdin: `${selections.join('\n')}\n`,
      timeoutMs: HOST_TIMEOUT_MS,
    });
  }

  async mountOptions(mountPoint: string): Promise<readonly string[]> {
    const result = await this.runner.run({
      command: 'findmnt',
      args: ['-n', '-o', 'OPTIONS', mountPoint],
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) {
      return [];
    }
    return result.stdout
      .trim()
      .split(',')
      .filter((option) => option !== '');
  }

  async activateQuota(mountPoint: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'quotacheck',
      args: ['-ugm', mountPoint],
      timeoutMs: HOST_TIMEOUT_MS,
    });
    await runOrThrow(this.runner, {
      command: 'quotaon',
      args: ['-ug', mountPoint],
      timeoutMs: HOST_TIMEOUT_MS,
    });
  }

  private async chownIfPossible(file: RenderedFile): Promise<void> {
    // non-root test environments have no business chowning; the real install
    // path always runs as root — and there a failed chown is a real failure
    if (process.geteuid?.() !== 0) {
      return;
    }
    await runOrThrow(this.runner, {
      command: 'chown',
      args: [`${file.owner}:${file.group}`, file.path],
      timeoutMs: 10_000,
    });
  }
}
