import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunBackup } from '../../../src/application/maintenance/RunBackup.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { BackupHostAdapter } from '../../../src/infrastructure/system/BackupHostAdapter.js';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';

let dir: string;
let db: KoboxDatabase;
let adapter: BackupHostAdapter;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-backup-'));
  db = KoboxDatabase.open(join(dir, 'live', 'kobox.db').replace('/live/', '/'));
  adapter = new BackupHostAdapter(new ExecFileRunner(), db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('BackupHostAdapter (real sqlite + tar)', () => {
  it('should_produce_an_openable_online_dump_and_a_real_archive', async () => {
    db.raw.prepare("INSERT INTO mails (recipient, subject, body, next_attempt_at, created_at) VALUES ('a@example.org', 's', 'b', '2026-07-25 10:00:00', '2026-07-25 10:00:00')").run();
    const configDir = join(dir, 'etc-kobox');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'worker.env'), 'KOBOX_DB=x\n');
    const backupRoot = join(dir, 'backups');
    const runBackup = new RunBackup({
      backupHost: adapter,
      settings: { root: backupRoot, ttlDays: 7, keepMin: 3, configDirs: [configDir] },
    });

    const report = await runBackup.execute({ now: '2026-07-25 05:30:00' });

    const dump = KoboxDatabase.open(join(report.created, 'kobox.db'));
    const row = dump.raw.prepare('SELECT recipient FROM mails').get() as { recipient: string };
    dump.close();
    expect(row.recipient).toBe('a@example.org');
    expect(report.skippedDirs).toEqual([]);
    const archive = join(report.created, `${configDir.replaceAll('/', '-').replace(/^-/, '')}.tar.gz`);
    expect(existsSync(archive)).toBe(true);
    // the archive is a real tar: it lists the file we wrote
    const listing = await new ExecFileRunner().run({
      command: 'tar',
      args: ['-tzf', archive],
      timeoutMs: 30_000,
    });
    expect(listing.stdout).toContain('worker.env');
  });

  it('should_restore_a_dump_over_the_live_db_keeping_the_old_one_aside', async () => {
    const livePath = join(dir, 'kobox.db');
    db.raw.prepare("INSERT INTO mails (recipient, subject, body, next_attempt_at, created_at) VALUES ('keep@example.org', 's', 'b', '2026-07-25 10:00:00', '2026-07-25 10:00:00')").run();
    const backupDir = join(dir, 'backups', '20260725T053000Z');
    mkdirSync(backupDir, { recursive: true });
    await adapter.sqliteBackup(join(backupDir, 'kobox.db'));
    // post-backup mutation that the restore must roll back
    db.raw.prepare("UPDATE mails SET recipient = 'clobbered@example.org'").run();
    db.close();

    const aside = await adapter.restoreDatabase(join(backupDir, 'kobox.db'), livePath);

    const restored = KoboxDatabase.open(livePath);
    const row = restored.raw.prepare('SELECT recipient FROM mails').get() as { recipient: string };
    expect(row.recipient).toBe('keep@example.org');
    restored.close();
    expect(existsSync(aside)).toBe(true);
    db = KoboxDatabase.open(livePath); // for afterEach
  });

  it('should_list_and_remove_only_stamp_directories', async () => {
    const root = join(dir, 'backups');
    mkdirSync(join(root, '20260725T053000Z'), { recursive: true });
    mkdirSync(join(root, 'not-a-backup'), { recursive: true });

    expect(await adapter.listBackups(root)).toEqual(['20260725T053000Z']);
    await adapter.removeBackup(root, '20260725T053000Z');
    expect(existsSync(join(root, '20260725T053000Z'))).toBe(false);
    await expect(adapter.removeBackup(root, '../../etc')).rejects.toThrow(/refusing/);
  });
});
