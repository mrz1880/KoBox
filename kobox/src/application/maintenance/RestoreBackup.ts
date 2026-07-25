import type { SystemdPort } from '../../domain/installation/ports.js';
import type { BackupHostPort } from './BackupHostPort.js';

export interface RestoreBackupDeps {
  readonly backupHost: BackupHostPort;
  readonly systemd: SystemdPort;
  readonly liveDbPath: string;
}

export interface RestoreBackupInput {
  readonly backupDir: string;
}

export interface RestoreBackupReport {
  readonly restoredFrom: string;
  readonly asidePath: string;
}

// Direct-only root command. The worker stops around the swap so no writer
// holds the old file; the pre-restore DB is moved aside, never deleted
// (anti-§5.6 TRUNCATE-before-restore).
export class RestoreBackup {
  constructor(private readonly deps: RestoreBackupDeps) {}

  async execute(input: RestoreBackupInput): Promise<RestoreBackupReport> {
    const backupDb = `${input.backupDir}/kobox.db`;
    // stop/start, never disable/enable: a restore must not flip the unit's
    // boot enablement as a side effect
    await this.deps.systemd.stop('kobox-worker');
    try {
      const asidePath = await this.deps.backupHost.restoreDatabase(backupDb, this.deps.liveDbPath);
      return { restoredFrom: backupDb, asidePath };
    } finally {
      await this.deps.systemd.start('kobox-worker');
    }
  }
}
