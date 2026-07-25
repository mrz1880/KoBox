import { backupStamp, planBackupRotation } from '../../domain/maintenance/backup.js';
import type { BackupHostPort } from './BackupHostPort.js';

export interface BackupSettings {
  readonly root: string;
  readonly ttlDays: number;
  readonly keepMin: number;
  readonly configDirs: readonly string[];
}

export interface RunBackupDeps {
  readonly backupHost: BackupHostPort;
  readonly settings: BackupSettings;
}

export interface RunBackupInput {
  readonly now: string;
}

export interface RunBackupReport {
  readonly created: string;
  readonly skippedDirs: readonly string[];
  readonly deleted: readonly string[];
}

function archiveName(dir: string): string {
  return `${dir.replaceAll('/', '-').replace(/^-/, '')}.tar.gz`;
}

// Backup-Manager parity (AUDIT §1.7): online SQLite dump + config archives
// under a 0700 stamp directory, then TTL rotation. Restore is RestoreBackup.
export class RunBackup {
  constructor(private readonly deps: RunBackupDeps) {}

  async execute(input: RunBackupInput): Promise<RunBackupReport> {
    const { backupHost, settings } = this.deps;
    const stamp = backupStamp(input.now);
    const dir = `${settings.root}/${stamp}`;
    await backupHost.ensureDir(settings.root, '0700');
    await backupHost.ensureDir(dir, '0700');
    await backupHost.sqliteBackup(`${dir}/kobox.db`);
    const skippedDirs: string[] = [];
    for (const configDir of settings.configDirs) {
      const archived = await backupHost.archiveDir(configDir, `${dir}/${archiveName(configDir)}`);
      if (!archived) {
        skippedDirs.push(configDir);
      }
    }
    const existing = await backupHost.listBackups(settings.root);
    const deleted = planBackupRotation([...existing, stamp], input.now, settings);
    for (const oldStamp of deleted) {
      await backupHost.removeBackup(settings.root, oldStamp);
    }
    return { created: dir, skippedDirs, deleted };
  }
}
