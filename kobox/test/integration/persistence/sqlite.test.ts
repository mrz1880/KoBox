import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJob } from '../../../src/application/jobs/contract.js';
import { Quota } from '../../../src/domain/user/Quota.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteJobQueue } from '../../../src/infrastructure/persistence/SqliteJobQueue.js';
import { SqlitePortAllocator } from '../../../src/infrastructure/persistence/SqlitePortAllocator.js';
import { SqliteUserRepository } from '../../../src/infrastructure/persistence/SqliteUserRepository.js';
import { aUser } from '../../builders/UserBuilder.js';

let dir: string;
let db: KoboxDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-sqlite-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteUserRepository', () => {
  it('should_roundtrip_a_user_through_the_real_database', async () => {
    const repo = new SqliteUserRepository(db);

    const saved = await repo.save(aUser().withQuota(Quota.gib(412)).build());
    const found = await repo.findByUsername(Username.parse('alice'));

    expect(saved.id?.value).toBeGreaterThan(0);
    expect(found?.email.value).toBe('alice@example.org');
    expect(found?.quota.toGib()).toBe(412);
    expect(found?.scgiPort.value).toBe(51101);
    expect(found?.status.isSuspended()).toBe(false);
  });

  it('should_persist_status_transitions', async () => {
    const repo = new SqliteUserRepository(db);
    const saved = await repo.save(aUser().build());

    await repo.save(saved.suspend().user);

    const found = await repo.findByUsername(saved.username);
    expect(found?.status.isSuspended()).toBe(true);
    expect((await repo.listAll()).length).toBe(1);
  });

  it('should_enforce_username_uniqueness_at_the_database_level', async () => {
    const repo = new SqliteUserRepository(db);
    await repo.save(aUser().build());

    await expect(
      repo.save(aUser().withScgiPort(51199).withRtorrentPort(45999).build()),
    ).rejects.toThrow(/UNIQUE.*username/);
  });

  it('should_delete_a_user_row', async () => {
    const repo = new SqliteUserRepository(db);
    const saved = await repo.save(aUser().build());

    await repo.delete(saved.username);

    expect(await repo.findByUsername(saved.username)).toBeUndefined();
  });
});

describe('SqlitePortAllocator', () => {
  it('should_allocate_sequential_ports_from_the_configured_bases', async () => {
    const allocator = new SqlitePortAllocator(db);

    expect((await allocator.allocateScgiPort()).value).toBe(51101);
    expect((await allocator.allocateScgiPort()).value).toBe(51102);
    expect((await allocator.allocateRtorrentPort()).value).toBe(45000);
  });

  it('should_never_hand_out_the_same_port_twice_under_concurrency', async () => {
    const allocator = new SqlitePortAllocator(db);

    const ports = await Promise.all(
      Array.from({ length: 50 }, () => allocator.allocateScgiPort()),
    );

    const values = ports.map((p) => p.value);
    expect(new Set(values).size).toBe(50);
  });

  it('should_reuse_ports_released_by_a_deleted_user', async () => {
    const allocator = new SqlitePortAllocator(db);
    const repo = new SqliteUserRepository(db);
    const first = await allocator.allocateScgiPort();
    await repo.save(aUser().withScgiPort(first.value).build());

    await repo.delete(Username.parse('alice'));

    expect((await allocator.allocateScgiPort()).value).toBe(first.value);
  });
});

describe('SqliteJobQueue', () => {
  it('should_enqueue_claim_and_complete_a_job_fifo', async () => {
    const queue = new SqliteJobQueue(db);
    await queue.enqueue(parseJob('suspend-user', { username: 'alice' }));
    await queue.enqueue(parseJob('resume-user', { username: 'alice' }));

    const claimed = await queue.claimNextPending();

    expect(claimed?.job.type).toBe('suspend-user');
    if (!claimed) throw new Error('expected a job');
    await queue.markDone(claimed.id);
    expect((await queue.claimNextPending())?.job.type).toBe('resume-user');
  });

  it('should_not_hand_a_claimed_job_to_a_second_worker', async () => {
    const queue = new SqliteJobQueue(db);
    await queue.enqueue(parseJob('suspend-user', { username: 'alice' }));

    const first = await queue.claimNextPending();
    const second = await queue.claimNextPending();

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
  });

  it('should_record_failures_with_their_error', async () => {
    const queue = new SqliteJobQueue(db);
    await queue.enqueue(parseJob('suspend-user', { username: 'alice' }));
    const claimed = await queue.claimNextPending();
    if (!claimed) throw new Error('expected a job');

    await queue.markFailed(claimed.id, 'user alice not found');

    expect(await queue.claimNextPending()).toBeUndefined();
  });

  it('should_quarantine_tampered_payloads_and_serve_the_next_job', async () => {
    const queue = new SqliteJobQueue(db);
    const poisoned = await queue.enqueue(parseJob('suspend-user', { username: 'alice' }));
    await queue.enqueue(parseJob('resume-user', { username: 'alice' }));
    db.raw.prepare('UPDATE jobs SET payload_json = ? WHERE id = ?').run(
      JSON.stringify({ username: 'alice; rm -rf /' }),
      poisoned,
    );

    const claimed = await queue.claimNextPending();

    expect(claimed?.job.type).toBe('resume-user'); // poisoned job skipped, not fatal
    const row = db.raw.prepare('SELECT status, error FROM jobs WHERE id = ?').get(poisoned) as {
      status: string;
      error: string;
    };
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/username/);
  });

  it('should_fail_stale_running_jobs_on_recovery', async () => {
    const queue = new SqliteJobQueue(db);
    await queue.enqueue(parseJob('suspend-user', { username: 'alice' }));
    await queue.claimNextPending(); // now running, simulating a crashed worker

    const recovered = await queue.recoverStale();

    expect(recovered).toBe(1);
    const row = db.raw.prepare("SELECT status, error FROM jobs WHERE status = 'failed'").get() as {
      status: string;
      error: string;
    };
    expect(row.error).toMatch(/interrupted/);
    expect(await queue.claimNextPending()).toBeUndefined();
  });
});
