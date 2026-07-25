import { describe, expect, it } from 'vitest';
import type { GitPort } from '../../../src/application/maintenance/GitPort.js';
import type {
  ReleaseRecord,
  ReleaseRepositoryPort,
  ReleaseState,
} from '../../../src/application/maintenance/ReleaseRepositoryPort.js';
import { UpgradeRelease } from '../../../src/application/maintenance/UpgradeRelease.js';
import type { UpgradeHostPort } from '../../../src/application/maintenance/UpgradeHostPort.js';

const SETTINGS = {
  repoDir: '/opt/KoBox',
  releasesDir: '/opt/kobox/releases',
  currentLink: '/opt/kobox/current',
};
const SHA = 'a'.repeat(40);
const STAGED_PATH = `/opt/kobox/releases/${SHA}`;
const NOW = '2026-07-25 10:00:00';

class FakeGit implements GitPort {
  fetched = 0;
  refs = new Map<string, string>([['v2.0.0', SHA]]);
  readonly worktrees = new Map<string, string>();

  fetch(): Promise<void> {
    this.fetched += 1;
    return Promise.resolve();
  }

  refExists(_repo: string, ref: string): Promise<boolean> {
    return Promise.resolve(this.refs.has(ref));
  }

  resolveRef(_repo: string, ref: string): Promise<string> {
    const sha = this.refs.get(ref);
    return sha ? Promise.resolve(sha) : Promise.reject(new Error(`unknown ref ${ref}`));
  }

  worktreeAdd(_repo: string, path: string, ref: string): Promise<void> {
    this.worktrees.set(path, ref);
    return Promise.resolve();
  }

  worktreeRemove(_repo: string, path: string): Promise<void> {
    this.worktrees.delete(path);
    return Promise.resolve();
  }

  currentRef(): Promise<string> {
    return Promise.resolve('b'.repeat(40));
  }
}

class InMemoryReleases implements ReleaseRepositoryPort {
  readonly rows: {
    id: number;
    ref: string;
    path: string;
    state: ReleaseState;
    createdAt: string;
    switchedAt?: string;
  }[] = [];
  private nextId = 1;

  record(ref: string, path: string, now: string): Promise<number> {
    const id = this.nextId++;
    this.rows.push({ id, ref, path, state: 'staged', createdAt: now });
    return Promise.resolve(id);
  }

  setState(id: number, state: ReleaseState, now: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.state = state;
      if (state === 'current') {
        row.switchedAt = now;
      }
    }
    return Promise.resolve();
  }

  findByState(state: ReleaseState): Promise<ReleaseRecord | undefined> {
    const row = [...this.rows].reverse().find((r) => r.state === state);
    return Promise.resolve(row ? { ...row } : undefined);
  }

  list(): Promise<readonly ReleaseRecord[]> {
    return Promise.resolve([...this.rows].reverse().map((row) => ({ ...row })));
  }
}

class FakeUpgradeHost implements UpgradeHostPort {
  built: string[] = [];
  migrated: string[] = [];
  current: string | undefined = '/opt/KoBox/kobox';
  readonly switches: string[] = [];
  restarts = 0;
  failBuild = false;
  failMigrate = false;
  failVerifyOnce = false;

  buildRelease(path: string): Promise<void> {
    if (this.failBuild) {
      return Promise.reject(new Error('pnpm build exited 2'));
    }
    this.built.push(path);
    return Promise.resolve();
  }

  migrateWith(path: string): Promise<void> {
    if (this.failMigrate) {
      return Promise.reject(new Error('migrate exited 1'));
    }
    this.migrated.push(path);
    return Promise.resolve();
  }

  currentTarget(): Promise<string | undefined> {
    return Promise.resolve(this.current);
  }

  switchCurrent(_link: string, target: string): Promise<void> {
    this.current = target;
    this.switches.push(target);
    return Promise.resolve();
  }

  restartWorkerAndVerify(): Promise<boolean> {
    this.restarts += 1;
    if (this.failVerifyOnce) {
      this.failVerifyOnce = false;
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }
}

interface World {
  git: FakeGit;
  releases: InMemoryReleases;
  host: FakeUpgradeHost;
  backups: string[];
  upgrade: UpgradeRelease;
}

function world(): World {
  const git = new FakeGit();
  const releases = new InMemoryReleases();
  const host = new FakeUpgradeHost();
  const backups: string[] = [];
  const upgrade = new UpgradeRelease({
    git,
    releases,
    host,
    backup: {
      execute: (input: { now: string }) => {
        backups.push(input.now);
        return Promise.resolve({
          created: '/var/backups/kobox/x',
          skippedDirs: [],
          deleted: [],
        });
      },
    },
    settings: SETTINGS,
  });
  return { git, releases, host, backups, upgrade };
}

describe('UpgradeRelease', () => {
  it('should_stage_build_backup_migrate_switch_and_restart_in_order', async () => {
    const w = world();

    const report = await w.upgrade.execute({ to: 'v2.0.0', now: NOW });

    expect(w.git.fetched).toBe(1);
    expect(w.git.worktrees.get(STAGED_PATH)).toBe('v2.0.0');
    expect(w.host.built).toEqual([STAGED_PATH]);
    expect(w.backups).toEqual([NOW]); // backup BEFORE migration
    expect(w.host.migrated).toEqual([STAGED_PATH]);
    expect(w.host.current).toBe(STAGED_PATH);
    expect(w.host.restarts).toBe(1);
    expect(report.to).toBe('v2.0.0');
    expect(report.sha).toBe(SHA);
    expect((await w.releases.findByState('current'))?.path).toBe(STAGED_PATH);
  });

  it('should_fail_with_guidance_when_the_ref_does_not_exist', async () => {
    const w = world();

    await expect(w.upgrade.execute({ to: 'v9.9.9', now: NOW })).rejects.toThrow(/v9\.9\.9/);
    expect(w.host.built).toEqual([]);
    expect(w.host.current).toBe('/opt/KoBox/kobox'); // untouched
  });

  it('should_remove_the_worktree_and_keep_current_when_the_build_fails', async () => {
    const w = world();
    w.host.failBuild = true;

    await expect(w.upgrade.execute({ to: 'v2.0.0', now: NOW })).rejects.toThrow(/pnpm build/);

    expect(w.git.worktrees.size).toBe(0); // staged tree cleaned up
    expect(w.host.current).toBe('/opt/KoBox/kobox');
    expect(w.host.restarts).toBe(0);
    expect((await w.releases.list())[0]?.state).toBe('failed');
  });

  it('should_keep_current_when_the_migration_fails_after_the_backup', async () => {
    const w = world();
    w.host.failMigrate = true;

    await expect(w.upgrade.execute({ to: 'v2.0.0', now: NOW })).rejects.toThrow(/migrate/);

    expect(w.backups).toHaveLength(1);
    expect(w.host.current).toBe('/opt/KoBox/kobox');
    expect(w.git.worktrees.size).toBe(0);
    expect((await w.releases.list())[0]?.state).toBe('failed');
  });

  it('should_flip_back_when_the_new_worker_does_not_come_up', async () => {
    const w = world();
    w.host.failVerifyOnce = true;

    await expect(w.upgrade.execute({ to: 'v2.0.0', now: NOW })).rejects.toThrow(/worker/i);

    // §5.6: the old version keeps running, loudly
    expect(w.host.current).toBe('/opt/KoBox/kobox');
    expect(w.host.switches).toEqual([STAGED_PATH, '/opt/KoBox/kobox']);
    expect(w.host.restarts).toBe(2); // failed verify + rollback restart
    expect((await w.releases.list())[0]?.state).toBe('failed');
  });

  it('should_refuse_when_a_staged_release_is_already_pending', async () => {
    const w = world();
    await w.releases.record('v1.5.0', '/opt/kobox/releases/old', NOW);

    await expect(w.upgrade.execute({ to: 'v2.0.0', now: NOW })).rejects.toThrow(/staged/);
  });

  it('should_rollback_to_the_previous_release', async () => {
    const w = world();
    await w.upgrade.execute({ to: 'v2.0.0', now: NOW });
    w.git.refs.set('v3.0.0', 'c'.repeat(40));
    await w.upgrade.execute({ to: 'v3.0.0', now: '2026-07-25 11:00:00' });
    expect(w.host.current).toBe(`/opt/kobox/releases/${'c'.repeat(40)}`);

    const report = await w.upgrade.rollback({ now: '2026-07-25 12:00:00' });

    expect(w.host.current).toBe(STAGED_PATH); // back on v2
    expect(report.to).toBe('v2.0.0');
    expect((await w.releases.findByState('current'))?.ref).toBe('v2.0.0');
    expect((await w.releases.findByState('previous'))?.ref).toBe('v3.0.0');
  });

  it('should_build_and_link_the_package_subdir_when_the_repo_nests_it', async () => {
    const w = world();
    const nested = new UpgradeRelease({
      git: w.git,
      releases: w.releases,
      host: w.host,
      backup: { execute: () => Promise.resolve({ created: '/b', skippedDirs: [], deleted: [] }) },
      settings: { ...SETTINGS, packageSubdir: 'kobox' },
    });

    await nested.execute({ to: 'v2.0.0', now: NOW });

    expect(w.host.built).toEqual([`${STAGED_PATH}/kobox`]);
    expect(w.host.migrated).toEqual([`${STAGED_PATH}/kobox`]);
    expect(w.host.current).toBe(`${STAGED_PATH}/kobox`);
    // the ledger keeps the worktree root (what git added/removes)
    expect((await w.releases.findByState('current'))?.path).toBe(STAGED_PATH);
  });

  it('should_refuse_rollback_without_a_previous_release', async () => {
    const w = world();

    await expect(w.upgrade.rollback({ now: NOW })).rejects.toThrow(/previous/);
  });
});
