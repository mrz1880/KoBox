import { beforeEach, describe, expect, it } from 'vitest';
import { parseJob, type Job } from '../../../src/application/jobs/contract.js';
import type { ClaimedJob, JobQueuePort } from '../../../src/application/jobs/JobQueuePort.js';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../src/domain/user/Password.js';
import type { PasswordHasherPort } from '../../../src/domain/user/ports.js';
import { Username } from '../../../src/domain/user/Username.js';
import { InMemoryTorrentInstanceRepository } from '../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryTorrentRepository } from '../../../src/infrastructure/persistence/InMemoryTorrentRepository.js';
import { InMemoryUserRepository } from '../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNotifications } from '../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeQuota } from '../../../src/infrastructure/system/fakes/FakeQuota.js';
import { FakeRtorrentConfig } from '../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeRtorrentControl } from '../../../src/infrastructure/system/fakes/FakeRtorrentControl.js';
import { FakeServiceControl } from '../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeSftp } from '../../../src/infrastructure/system/fakes/FakeSftp.js';
import { FakeSystemAccounts } from '../../../src/infrastructure/system/fakes/FakeSystemAccounts.js';
import { FakeTorrentMetainfo } from '../../../src/infrastructure/system/fakes/FakeTorrentMetainfo.js';
import { FakeUserScriptRunner } from '../../../src/infrastructure/system/fakes/FakeUserScriptRunner.js';
import { FakeWatchDirs } from '../../../src/infrastructure/system/fakes/FakeWatchDirs.js';
import { loadRtorrentTemplates } from '../../../src/infrastructure/templates/TemplateProvider.js';
import { buildJob } from '../../../src/interfaces/cli/buildJob.js';
import { JobWorker } from '../../../src/interfaces/worker/JobWorker.js';
import { buildTorrentUseCases, buildUseCases } from '../../../src/interfaces/useCases.js';

class InMemoryJobQueue implements JobQueuePort {
  private readonly rows: { id: number; job: Job; status: string; error?: string }[] = [];
  private nextId = 1;

  enqueue(job: Job): Promise<number> {
    const id = this.nextId++;
    this.rows.push({ id, job, status: 'pending' });
    return Promise.resolve(id);
  }

  claimNextPending(): Promise<ClaimedJob | undefined> {
    const row = this.rows.find((r) => r.status === 'pending');
    if (!row) return Promise.resolve(undefined);
    row.status = 'running';
    return Promise.resolve({ id: row.id, job: row.job });
  }

  markDone(id: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = 'done';
    return Promise.resolve();
  }

  markFailed(id: number, error: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = 'failed';
      row.error = error;
    }
    return Promise.resolve();
  }

  statusOf(id: number): string | undefined {
    return this.rows.find((r) => r.id === id)?.status;
  }

  errorOf(id: number): string | undefined {
    return this.rows.find((r) => r.id === id)?.error;
  }

  recoverStale(): Promise<number> {
    const stale = this.rows.filter((r) => r.status === 'running');
    for (const row of stale) {
      row.status = 'failed';
      row.error = 'interrupted: worker restarted';
    }
    return Promise.resolve(stale.length);
  }
}

class FakePasswordHasher implements PasswordHasherPort {
  hash(password: Password): Promise<HashedPassword> {
    return Promise.resolve(
      HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}${String(password.reveal().length)}`),
    );
  }
}

const alice = Username.parse('alice');

interface World {
  queue: InMemoryJobQueue;
  accounts: FakeSystemAccounts;
  services: FakeServiceControl;
  instances: InMemoryTorrentInstanceRepository;
  torrents: InMemoryTorrentRepository;
  scripts: FakeUserScriptRunner;
  worker: JobWorker;
  hasher: FakePasswordHasher;
}

let world: World;

beforeEach(() => {
  const repo = new InMemoryUserRepository();
  const accounts = new FakeSystemAccounts();
  const quota = new FakeQuota();
  const sftp = new FakeSftp();
  const services = new FakeServiceControl();
  const notifications = new FakeNotifications();
  let nextScgi = 51101;
  let nextRtorrent = 45000;
  const useCases = buildUseCases({
    repo,
    accounts,
    quota,
    sftp,
    services,
    notifications,
    allocator: {
      allocateScgiPort: () =>
        import('../../../src/domain/user/Port.js').then((m) => m.ScgiPort.parse(nextScgi++)),
      allocateRtorrentPort: () =>
        import('../../../src/domain/user/Port.js').then((m) => m.RtorrentPort.parse(nextRtorrent++)),
      releaseScgiPort: () => Promise.resolve(),
      releaseRtorrentPort: () => Promise.resolve(),
    },
  });
  const instances = new InMemoryTorrentInstanceRepository();
  const torrents = new InMemoryTorrentRepository();
  const scripts = new FakeUserScriptRunner();
  const torrentUseCases = buildTorrentUseCases({
    users: repo,
    instances,
    torrents,
    config: new FakeRtorrentConfig(),
    watchDirs: new FakeWatchDirs(),
    services,
    metainfo: new FakeTorrentMetainfo(),
    control: new FakeRtorrentControl(),
    scripts,
    templates: loadRtorrentTemplates(),
    settings: { koboxBin: '/usr/local/bin/kobox' },
  });
  const queue = new InMemoryJobQueue();
  world = {
    queue,
    accounts,
    services,
    instances,
    torrents,
    scripts,
    hasher: new FakePasswordHasher(),
    worker: new JobWorker(queue, useCases, torrentUseCases),
  };
});

async function enqueueCreateAlice(): Promise<number> {
  const job = await buildJob.createUser(
    {
      username: 'alice',
      email: 'alice@example.org',
      accountType: 'normal',
      quotaGib: 412,
      proxyPort: 8080,
    },
    Password.parse('s3cretpw'),
    world.hasher,
  );
  return world.queue.enqueue(job);
}

describe('CLI enqueue -> root worker loop (the privilege seam)', () => {
  it('should_create_a_user_end_to_end_through_a_typed_job', async () => {
    const id = await enqueueCreateAlice();

    const processed = await world.worker.processNext();

    expect(processed).toBe(true);
    expect(world.queue.statusOf(id)).toBe('done');
    expect(await world.accounts.accountExists(alice)).toBe(true);
    // provisioning is a separate chained job: not yet executed after one step
    expect(await world.services.isUserServiceRunning(alice)).toBe(false);
  });

  it('should_chain_rtorrent_provisioning_after_create_user', async () => {
    await enqueueCreateAlice();

    await world.worker.drain();

    expect(await world.instances.findByUsername(alice)).toBeDefined();
    expect(world.services.unitContentFor(alice)).toContain('User=alice');
    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
  });

  it('should_chain_deprovisioning_after_delete_user', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(buildJob.deleteUser({ username: 'alice' }));

    await world.worker.drain();

    expect(await world.instances.findByUsername(alice)).toBeUndefined();
    expect(world.services.unitContentFor(alice)).toBeUndefined();
  });

  it('should_execute_a_torrent_event_job_end_to_end', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(
      parseJob('torrent-event', {
        username: 'alice',
        event: 'finished',
        infoHash: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
        name: 'x',
        basePath: '/home/alice/rtorrent/complete/x',
        directory: '/home/alice/rtorrent/complete',
      }),
    );

    await world.worker.drain();

    const torrent = await world.torrents.findByInfoHash(
      alice,
      InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'),
    );
    expect(torrent?.state.value).toBe('completed');
    expect(world.scripts.runs).toHaveLength(1);
  });

  it('should_execute_flag_and_watch_dir_jobs', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(parseJob('set-sync-disabled', { username: 'alice', disabled: true }));
    await world.queue.enqueue(parseJob('add-watch-dir', { username: 'alice', label: 'films' }));

    await world.worker.drain();

    const instance = await world.instances.findByUsername(alice);
    expect(instance?.syncDisabled).toBe(true);
    expect(instance?.watchDirs.map((dir) => dir.label?.value)).toEqual([undefined, 'films']);
  });

  it('should_suspend_then_resume_via_jobs', async () => {
    await enqueueCreateAlice();
    await world.queue.enqueue(buildJob.suspendUser({ username: 'alice' }));
    await world.queue.enqueue(buildJob.resumeUser({ username: 'alice' }));

    await world.worker.drain();

    expect(await world.accounts.isLocked(alice)).toBe(false);
    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
  });

  it('should_mark_a_job_failed_with_its_error_and_keep_going', async () => {
    const id = await world.queue.enqueue(buildJob.suspendUser({ username: 'ghost' }));

    const processed = await world.worker.processNext();

    expect(processed).toBe(true);
    expect(world.queue.statusOf(id)).toBe('failed');
    expect(world.queue.errorOf(id)).toMatch(/ghost not found/);
  });

  it('should_report_nothing_to_do_on_an_empty_queue', async () => {
    expect(await world.worker.processNext()).toBe(false);
  });
});
