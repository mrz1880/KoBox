import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, copyFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { BackupHostPort } from '../../application/maintenance/BackupHostPort.js';
import type { KoboxDatabase } from '../persistence/db.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const STAMP_PATTERN = /^\d{8}T\d{6}Z$/;
const TAR_TIMEOUT_MS = 120_000;

export class BackupHostAdapter implements BackupHostPort {
  constructor(
    private readonly runner: CommandRunner,
    // undefined in restore-only contexts (the CLI never opens the live DB
    // it is about to replace)
    private readonly db?: KoboxDatabase,
  ) {}

  async ensureDir(path: string, mode: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: parseInt(mode, 8) });
    await chmod(path, parseInt(mode, 8));
  }

  async sqliteBackup(destPath: string): Promise<void> {
    if (!this.db) {
      throw new Error('sqliteBackup requires an open database');
    }
    // the engine's online backup API: consistent snapshot, WAL-safe
    await this.db.raw.backup(destPath);
  }

  async archiveDir(srcDir: string, destTarGz: string): Promise<boolean> {
    if (!existsSync(srcDir)) {
      return false;
    }
    await runOrThrow(this.runner, {
      command: 'tar',
      args: ['-czf', destTarGz, '-C', dirname(srcDir), basename(srcDir)],
      timeoutMs: TAR_TIMEOUT_MS,
    });
    return true;
  }

  async listBackups(root: string): Promise<readonly string[]> {
    if (!existsSync(root)) {
      return [];
    }
    const entries = await readdir(root);
    return entries.filter((entry) => STAMP_PATTERN.test(entry)).sort();
  }

  async removeBackup(root: string, stamp: string): Promise<void> {
    // the pattern gate keeps a corrupted stamp from ever rm-ing outside root
    if (!STAMP_PATTERN.test(stamp)) {
      throw new Error(`refusing to remove non-stamp directory ${JSON.stringify(stamp)}`);
    }
    await rm(`${root}/${stamp}`, { recursive: true, force: true });
  }

  async restoreDatabase(backupDbPath: string, liveDbPath: string): Promise<string> {
    if (!existsSync(backupDbPath)) {
      throw new Error(`no database dump at ${backupDbPath}`);
    }
    const asidePath = `${liveDbPath}.pre-restore`;
    if (existsSync(liveDbPath)) {
      await rename(liveDbPath, asidePath);
    }
    // an uncheckpointed WAL holds committed transactions: it moves WITH the
    // aside copy (SQLite finds it by name when that file is opened) instead
    // of being deleted — and must not shadow the restored database either
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${liveDbPath}${suffix}`)) {
        await rename(`${liveDbPath}${suffix}`, `${asidePath}${suffix}`);
      }
    }
    await copyFile(backupDbPath, liveDbPath);
    await chmod(liveDbPath, 0o600);
    return asidePath;
  }
}
