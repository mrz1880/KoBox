import { describe, expect, it } from 'vitest';
import type { BackupHostPort } from '../../../src/application/maintenance/BackupHostPort.js';
import { RunBackup } from '../../../src/application/maintenance/RunBackup.js';

class FakeBackupHost implements BackupHostPort {
  readonly dirs: [string, string][] = [];
  readonly sqliteBackups: string[] = [];
  readonly archived: [string, string][] = [];
  readonly removed: string[] = [];
  existingStamps: string[] = [];
  presentDirs = new Set<string>(['/etc/kobox']);

  ensureDir(path: string, mode: string): Promise<void> {
    this.dirs.push([path, mode]);
    return Promise.resolve();
  }

  sqliteBackup(destPath: string): Promise<void> {
    this.sqliteBackups.push(destPath);
    return Promise.resolve();
  }

  archiveDir(srcDir: string, destTarGz: string): Promise<boolean> {
    if (!this.presentDirs.has(srcDir)) {
      return Promise.resolve(false);
    }
    this.archived.push([srcDir, destTarGz]);
    return Promise.resolve(true);
  }

  listBackups(): Promise<readonly string[]> {
    return Promise.resolve(this.existingStamps);
  }

  removeBackup(_root: string, stamp: string): Promise<void> {
    this.removed.push(stamp);
    return Promise.resolve();
  }

  restoreDatabase(): Promise<string> {
    return Promise.reject(new Error('not under test'));
  }
}

const SETTINGS = {
  root: '/var/backups/kobox',
  ttlDays: 7,
  keepMin: 3,
  configDirs: ['/etc/kobox', '/etc/letsencrypt'],
};

describe('RunBackup', () => {
  it('should_dump_the_database_and_archive_present_config_dirs', async () => {
    const host = new FakeBackupHost();
    const runBackup = new RunBackup({ backupHost: host, settings: SETTINGS });

    const report = await runBackup.execute({ now: '2026-07-25 05:30:00' });

    const dir = '/var/backups/kobox/20260725T053000Z';
    expect(report.created).toBe(dir);
    expect(host.dirs).toContainEqual([dir, '0700']);
    expect(host.sqliteBackups).toEqual([`${dir}/kobox.db`]);
    // /etc/kobox present -> archived; /etc/letsencrypt absent -> skipped
    expect(host.archived).toEqual([['/etc/kobox', `${dir}/etc-kobox.tar.gz`]]);
    expect(report.skippedDirs).toEqual(['/etc/letsencrypt']);
  });

  it('should_rotate_expired_backups_beyond_keep_min', async () => {
    const host = new FakeBackupHost();
    host.existingStamps = [
      '20260601T053000Z',
      '20260710T053000Z',
      '20260723T053000Z',
      '20260724T053000Z',
    ];
    const runBackup = new RunBackup({ backupHost: host, settings: SETTINGS });

    const report = await runBackup.execute({ now: '2026-07-25 05:30:00' });

    // after creating today's, five exist; the two expired beyond keepMin die
    expect(report.deleted).toEqual(['20260601T053000Z', '20260710T053000Z']);
    expect(host.removed).toEqual(['20260601T053000Z', '20260710T053000Z']);
  });
});
