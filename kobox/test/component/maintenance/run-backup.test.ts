import { describe, expect, it } from 'vitest';
import type { BackupHostPort } from '../../../src/application/maintenance/BackupHostPort.js';
import { RunBackup } from '../../../src/application/maintenance/RunBackup.js';
import { restartKitTrees } from '../../../src/domain/torrent/RestartKit.js';
import { InMemoryUserRepository } from '../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { aUser } from '../../builders/UserBuilder.js';

class FakeBackupHost implements BackupHostPort {
  readonly dirs: [string, string][] = [];
  readonly sqliteBackups: string[] = [];
  readonly archived: [string, string][] = [];
  readonly archivedTrees: [string, readonly string[], string][] = [];
  readonly removed: string[] = [];
  existingStamps: string[] = [];
  presentDirs = new Set<string>(['/etc/kobox']);
  failingHomes = new Set<string>();

  ensureDir(path: string, mode: string): Promise<void> {
    this.dirs.push([path, mode]);
    // mirror the real adapter: a created stamp dir is visible to readdir
    const stamp = path.split('/').at(-1) ?? '';
    if (/^\d{8}T\d{6}Z$/.test(stamp)) {
      this.existingStamps.push(stamp);
    }
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

  archiveTrees(baseDir: string, trees: readonly string[], destTarGz: string): Promise<void> {
    if (this.failingHomes.has(baseDir)) {
      return Promise.reject(new Error('tar: write error'));
    }
    this.archivedTrees.push([baseDir, trees, destTarGz]);
    return Promise.resolve();
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

function runBackupOn(host: BackupHostPort, users = new InMemoryUserRepository()): RunBackup {
  return new RunBackup({ backupHost: host, users, settings: SETTINGS });
}

describe('RunBackup', () => {
  it('should_dump_the_database_and_archive_present_config_dirs', async () => {
    const host = new FakeBackupHost();
    const runBackup = runBackupOn(host);

    const report = await runBackup.execute({ now: '2026-07-25 05:30:00' });

    const dir = '/var/backups/kobox/20260725T053000Z';
    expect(report.created).toBe(dir);
    expect(host.dirs).toContainEqual([dir, '0700']);
    expect(host.sqliteBackups).toEqual([`${dir}/kobox.db`]);
    // /etc/kobox present -> archived; /etc/letsencrypt absent -> skipped
    expect(host.archived).toEqual([['/etc/kobox', `${dir}/etc-kobox.tar.gz`]]);
    expect(report.skippedDirs).toEqual(['/etc/letsencrypt']);
  });

  it('should_not_let_the_fresh_stamp_count_twice_against_keep_min', async () => {
    // review #3: listBackups already sees today's dir (ensureDir ran first);
    // the box-slept-a-month case must still keep keepMin DISTINCT backups
    const host = new FakeBackupHost();
    host.existingStamps = ['20260601T053000Z', '20260602T053000Z', '20260603T053000Z'];
    const runBackup = runBackupOn(host);

    const report = await runBackup.execute({ now: '2026-07-25 05:30:00' });

    // survivors = today + the two newest expired = 3 distinct backups
    expect(report.deleted).toEqual(['20260601T053000Z']);
  });

  it('should_rotate_expired_backups_beyond_keep_min', async () => {
    const host = new FakeBackupHost();
    host.existingStamps = [
      '20260601T053000Z',
      '20260710T053000Z',
      '20260723T053000Z',
      '20260724T053000Z',
    ];
    const runBackup = runBackupOn(host);

    const report = await runBackup.execute({ now: '2026-07-25 05:30:00' });

    // after creating today's, five exist; the two expired beyond keepMin die
    expect(report.deleted).toEqual(['20260601T053000Z', '20260710T053000Z']);
    expect(host.removed).toEqual(['20260601T053000Z', '20260710T053000Z']);
  });

  it('should_archive_each_member_restart_kit_from_their_home', async () => {
    const host = new FakeBackupHost();
    const users = new InMemoryUserRepository();
    await users.save(aUser().withUsername('alice').build());
    await users.save(aUser().withUsername('bob').withEmail('bob@example.org').build());

    await runBackupOn(host, users).execute({ now: '2026-07-25 05:30:00' });

    const dir = '/var/backups/kobox/20260725T053000Z';
    expect(host.dirs).toContainEqual([`${dir}/members`, '0700']);
    expect(host.archivedTrees).toEqual([
      ['/home/alice', restartKitTrees(), `${dir}/members/alice.tar.gz`],
      ['/home/bob', restartKitTrees(), `${dir}/members/bob.tar.gz`],
    ]);
  });

  it('should_report_a_member_whose_archive_fails_and_carry_on', async () => {
    const host = new FakeBackupHost();
    host.failingHomes.add('/home/alice');
    host.existingStamps = ['20260601T053000Z', '20260710T053000Z', '20260723T053000Z'];
    const users = new InMemoryUserRepository();
    await users.save(aUser().withUsername('alice').build());
    await users.save(aUser().withUsername('bob').withEmail('bob@example.org').build());

    const report = await runBackupOn(host, users).execute({ now: '2026-07-25 05:30:00' });

    expect(report.failedMembers).toEqual([{ username: 'alice', reason: 'tar: write error' }]);
    expect(host.archivedTrees.map(([home]) => home)).toEqual(['/home/bob']);
    // the rest of the backup still ran: rotation is the last step
    expect(report.deleted).toEqual(['20260601T053000Z']);
  });
});
