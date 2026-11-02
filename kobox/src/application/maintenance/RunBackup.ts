import { backupStamp, planBackupRotation } from '../../domain/maintenance/backup.js';
import { restartKitTrees } from '../../domain/torrent/RestartKit.js';
import { homeOf } from '../../domain/user/homeDirectory.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { BackupHostPort } from './BackupHostPort.js';

// under each stamp dir, one <username>.tar.gz per member (docs/OPS.md restores it)
const MEMBERS_DIR = 'members';

export interface BackupSettings {
  readonly root: string;
  readonly ttlDays: number;
  readonly keepMin: number;
  readonly configDirs: readonly string[];
}

export interface RunBackupDeps {
  readonly backupHost: BackupHostPort;
  // whose restart kits to archive: every member, suspended ones included
  readonly users: Pick<UserRepository, 'listAll'>;
  readonly settings: BackupSettings;
}

export interface RunBackupInput {
  readonly now: string;
}

export interface MemberArchiveFailure {
  readonly username: string;
  readonly reason: string;
}

export interface RunBackupReport {
  readonly created: string;
  readonly skippedDirs: readonly string[];
  // one member's archive failing never costs the others, nor the database dump
  readonly failedMembers: readonly MemberArchiveFailure[];
  readonly deleted: readonly string[];
}

function archiveName(dir: string): string {
  return `${dir.replaceAll('/', '-').replace(/^-/, '')}.tar.gz`;
}

// Backup-Manager parity: online SQLite dump + config archives + each member's
// restart kit under a 0700 stamp directory, then TTL rotation. The database
// comes back through RestoreBackup, a restart kit by hand (docs/OPS.md).
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
    const failedMembers = await this.archiveRestartKits(`${dir}/${MEMBERS_DIR}`);
    const existing = await backupHost.listBackups(settings.root);
    // listBackups already sees the dir created above: dedupe so today's
    // stamp cannot occupy two keepMin survivor slots
    const deleted = planBackupRotation([...new Set([...existing, stamp])], input.now, settings);
    for (const oldStamp of deleted) {
      await backupHost.removeBackup(settings.root, oldStamp);
    }
    return { created: dir, skippedDirs, failedMembers, deleted };
  }

  // /home sits on a disk of its own: what each member's rtorrent needs to
  // start again by itself, and fetch the downloads again, if that disk is lost
  private async archiveRestartKits(membersDir: string): Promise<MemberArchiveFailure[]> {
    const { backupHost, users } = this.deps;
    await backupHost.ensureDir(membersDir, '0700');
    const failures: MemberArchiveFailure[] = [];
    for (const user of await users.listAll()) {
      const username = user.username.value;
      try {
        await backupHost.archiveTrees(
          homeOf(user.username),
          restartKitTrees(),
          `${membersDir}/${username}.tar.gz`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push({ username, reason });
      }
    }
    return failures;
  }
}
