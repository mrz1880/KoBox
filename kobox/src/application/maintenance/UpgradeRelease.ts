import type { GitPort } from './GitPort.js';
import type { ReleaseRepositoryPort } from './ReleaseRepositoryPort.js';
import type { RunBackupInput, RunBackupReport } from './RunBackup.js';
import type { UpgradeHostPort } from './UpgradeHostPort.js';

export interface UpgradeSettings {
  readonly repoDir: string;
  readonly releasesDir: string;
  readonly currentLink: string;
  // where the node package lives inside a repo checkout (KoBox nests it
  // under kobox/); the ledger keeps worktree roots, the symlink targets this
  readonly packageSubdir?: string;
}

interface BackupRunner {
  execute(input: RunBackupInput): Promise<RunBackupReport>;
}

export interface UpgradeReleaseDeps {
  readonly git: GitPort;
  readonly releases: ReleaseRepositoryPort;
  readonly host: UpgradeHostPort;
  readonly backup: BackupRunner;
  readonly settings: UpgradeSettings;
}

export interface UpgradeInput {
  readonly to: string;
  readonly now: string;
  readonly offline?: boolean;
}

export interface UpgradeReport {
  readonly from?: string;
  readonly to: string;
  readonly sha: string;
  readonly backupDir: string;
}

export interface RollbackInput {
  readonly now: string;
}

export interface RollbackReport {
  readonly to: string;
  readonly path: string;
}

export class UpgradeError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'UpgradeError';
  }
}

// The anti-GitHubRepoUpdate (§5.6): a pinned ref is staged as a SEPARATE
// worktree, built, migrated (after a backup), then activated by an atomic
// symlink flip. Any failure leaves the running version in place; a worker
// that does not come back flips straight back. Never a reboot, never a
// mutation of the tree that is running.
export class UpgradeRelease {
  constructor(private readonly deps: UpgradeReleaseDeps) {}

  private packageDir(worktreePath: string): string {
    const sub = this.deps.settings.packageSubdir;
    return sub !== undefined && sub !== '' ? `${worktreePath}/${sub}` : worktreePath;
  }

  async execute(input: UpgradeInput): Promise<UpgradeReport> {
    const { git, releases, host, backup, settings } = this.deps;
    if (input.offline !== true) {
      await git.fetch(settings.repoDir);
    }
    if (!(await git.refExists(settings.repoDir, input.to))) {
      throw new UpgradeError(
        `ref ${JSON.stringify(input.to)} not found in ${settings.repoDir} — push the tag to the remote or check the spelling`,
      );
    }
    const staged = await releases.findByState('staged');
    if (staged) {
      throw new UpgradeError(
        `a staged release already exists (${staged.ref} at ${staged.path}) — a previous upgrade crashed; remove the worktree and mark the row failed before retrying`,
      );
    }
    const sha = await git.resolveRef(settings.repoDir, input.to);
    const path = `${settings.releasesDir}/${sha}`;
    // reap any leftover worktree at this path (failed build, or a release we
    // rolled back from): retrying a ref must always stage a FRESH checkout
    await git.worktreeRemove(settings.repoDir, path).catch(() => undefined);
    await git.worktreeAdd(settings.repoDir, path, input.to);
    // upsert by path: the reaped release's row is reused as staged
    const releaseId = await releases.record(input.to, path, input.now);

    const abort = async (error: unknown): Promise<never> => {
      // cleanup best-effort: a failed remove must never mask the real error
      await git.worktreeRemove(settings.repoDir, path).catch(() => undefined);
      await releases.setState(releaseId, 'failed', input.now);
      throw error instanceof Error ? error : new Error(String(error));
    };

    try {
      await host.buildRelease(this.packageDir(path));
    } catch (error) {
      await abort(error);
    }
    const backupReport = await backup.execute({ now: input.now });
    try {
      await host.migrateWith(this.packageDir(path));
    } catch (error) {
      await abort(error);
    }

    const previousTarget = await host.currentTarget(settings.currentLink);
    const previousRelease = await releases.findByState('current');
    await host.switchCurrent(settings.currentLink, this.packageDir(path));
    if (await host.restartWorkerAndVerify()) {
      if (previousRelease) {
        await releases.setState(previousRelease.id, 'previous', input.now);
      }
      await releases.setState(releaseId, 'current', input.now);
      return {
        ...(previousRelease && { from: previousRelease.ref }),
        to: input.to,
        sha,
        backupDir: backupReport.created,
      };
    }
    // §5.6 fix: flip back, restart the old version, fail loudly
    let revertOk = false;
    if (previousTarget !== undefined) {
      await host.switchCurrent(settings.currentLink, previousTarget);
      revertOk = await host.restartWorkerAndVerify();
    }
    await releases.setState(releaseId, 'failed', input.now);
    throw new UpgradeError(
      revertOk
        ? `worker did not come up on ${input.to} — reverted to the previous release (DB backup at ${backupReport.created})`
        : `worker did not come up on ${input.to} AND the revert restart failed too — inspect journalctl -u kobox-worker NOW (DB backup at ${backupReport.created})`,
    );
  }

  // Undo-the-last-flip semantics, deliberately: current and previous swap,
  // so two successive rollbacks return to where you started (a ping-pong,
  // not a walk through history). Walking further back is `upgrade --to` with
  // the older ref — explicit beats an implicit history cursor.
  async rollback(input: RollbackInput): Promise<RollbackReport> {
    const { releases, host, settings } = this.deps;
    const previous = await releases.findByState('previous');
    if (!previous) {
      throw new UpgradeError('no previous release recorded — nothing to roll back to');
    }
    const current = await releases.findByState('current');
    await host.switchCurrent(settings.currentLink, this.packageDir(previous.path));
    if (!(await host.restartWorkerAndVerify())) {
      throw new UpgradeError(
        `worker did not come up on ${previous.ref} after rollback — inspect journalctl -u kobox-worker`,
      );
    }
    await releases.setState(previous.id, 'current', input.now);
    if (current) {
      await releases.setState(current.id, 'previous', input.now);
    }
    return { to: previous.ref, path: previous.path };
  }
}
