// Filesystem seam for backups: the use case decides WHAT, this executes.
// sqliteBackup must be the online-safe engine backup (WAL-aware), never a
// file copy of a live database.
export interface BackupHostPort {
  ensureDir(path: string, mode: string): Promise<void>;
  sqliteBackup(destPath: string): Promise<void>;
  // false when srcDir does not exist (nothing to archive is not an error)
  archiveDir(srcDir: string, destTarGz: string): Promise<boolean>;
  // one archive of the trees found under baseDir, named relative to it, owners
  // and modes kept; trees that do not exist are left out, and no archive is
  // written when none does (nothing to keep is not an error)
  archiveTrees(baseDir: string, trees: readonly string[], destTarGz: string): Promise<void>;
  listBackups(root: string): Promise<readonly string[]>;
  removeBackup(root: string, stamp: string): Promise<void>;
  // moves the live DB aside (never deletes it) and puts the backup in place;
  // returns the aside path
  restoreDatabase(backupDbPath: string, liveDbPath: string): Promise<string>;
}
