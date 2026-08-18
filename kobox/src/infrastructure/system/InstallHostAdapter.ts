import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, chmod, lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { ArchiveLayout, InstallHostPort } from '../../domain/installation/ports.js';
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

  // by name rather than by uid: the account exists by the time anything is
  // chowned onto it, and a name survives a box where ids differ
  async chown(path: string, owner: string, group: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'chown',
      args: ['-R', `${owner}:${group}`, path],
    });
  }

  async ensureSymlink(linkPath: string, target: string): Promise<boolean> {
    // lstat, not exists: a dangling link counts as present (upgrade owns it)
    const present = await lstat(linkPath).then(
      () => true,
      () => false,
    );
    if (present) {
      return false;
    }
    await mkdir(linkPath.slice(0, linkPath.lastIndexOf('/')), { recursive: true });
    await symlink(target, linkPath);
    return true;
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

  // -a, not -z: the compression is read from the file rather than assumed.
  // Nextcloud publishes .tar.bz2 and .zip and never .tar.gz, so the gzip-only
  // form could not open a single real release of it, while the components that
  // came first happened to ship gzip and hid that.
  async extractArchive(archive: string, destDir: string, layout: ArchiveLayout): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'tar',
      args: [
        '-xaf',
        archive,
        '-C',
        destDir,
        ...(layout === 'inside-one-directory' ? ['--strip-components=1'] : []),
      ],
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

  async postmap(path: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'postmap',
      args: [path],
      timeoutMs: HOST_TIMEOUT_MS,
    });
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

  async ensureServiceAccount(name: string): Promise<void> {
    // groupadd/useradd are idempotent-friendly: exit 9 = "already exists".
    await this.runAllowing([9], 'groupadd', ['--system', name]);
    await this.runAllowing(
      [9],
      'useradd',
      ['--system', '--gid', name, '--no-create-home', '--shell', '/usr/sbin/nologin', name],
    );
  }

  async setOwnership(path: string, owner: string, group: string, mode: string): Promise<void> {
    await chmod(path, parseInt(mode, 8));
    if (process.geteuid?.() !== 0) {
      return;
    }
    await runOrThrow(this.runner, {
      command: 'chown',
      args: [`${owner}:${group}`, path],
      timeoutMs: 10_000,
    });
  }

  private async runAllowing(
    okExitCodes: readonly number[],
    command: string,
    args: readonly string[],
  ): Promise<void> {
    if (process.geteuid?.() !== 0) {
      return;
    }
    const result = await this.runner.run({ command, args: [...args], timeoutMs: HOST_TIMEOUT_MS });
    if (result.exitCode !== 0 && !okExitCodes.includes(result.exitCode)) {
      throw new Error(`${command} ${args.join(' ')} failed (${String(result.exitCode)}): ${result.stderr.trim()}`);
    }
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
