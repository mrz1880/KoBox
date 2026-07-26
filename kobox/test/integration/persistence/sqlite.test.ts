import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJob } from '../../../src/application/jobs/contract.js';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { Label } from '../../../src/domain/torrent/Label.js';
import { Torrent } from '../../../src/domain/torrent/Torrent.js';
import { TorrentInstance } from '../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../src/domain/user/Port.js';
import { Quota } from '../../../src/domain/user/Quota.js';
import { Username } from '../../../src/domain/user/Username.js';
import { IpAddress } from '../../../src/domain/shared/IpAddress.js';
import { Blocklist } from '../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../src/domain/tracker/BlocklistUrl.js';
import { CertExpiry } from '../../../src/domain/tracker/CertExpiry.js';
import { Tracker } from '../../../src/domain/tracker/Tracker.js';
import { TrackerHost } from '../../../src/domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../../src/domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../../src/domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../../src/domain/tracker/TrackerProto.js';
import { Bandwidth } from '../../../src/domain/security/Bandwidth.js';
import { DynDnsHost } from '../../../src/domain/security/DynDnsHost.js';
import { ComponentName } from '../../../src/domain/installation/ComponentName.js';
import { Version } from '../../../src/domain/installation/Version.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteComponentRegistry } from '../../../src/infrastructure/persistence/SqliteComponentRegistry.js';
import { SqliteFairUseRepository } from '../../../src/infrastructure/persistence/SqliteFairUseRepository.js';
import { SqliteBlocklistRepository } from '../../../src/infrastructure/persistence/SqliteBlocklistRepository.js';
import { SqliteTrackerRepository } from '../../../src/infrastructure/persistence/SqliteTrackerRepository.js';
import { SqliteUserAddressRepository } from '../../../src/infrastructure/persistence/SqliteUserAddressRepository.js';
import { SqliteJobQueue } from '../../../src/infrastructure/persistence/SqliteJobQueue.js';
import { SqlitePortAllocator } from '../../../src/infrastructure/persistence/SqlitePortAllocator.js';
import { PortAlreadyClaimedError } from '../../../src/domain/user/PortAllocatorPort.js';
import { SqliteTorrentInstanceRepository } from '../../../src/infrastructure/persistence/SqliteTorrentInstanceRepository.js';
import { SqliteTorrentRepository } from '../../../src/infrastructure/persistence/SqliteTorrentRepository.js';
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

  it('should_claim_an_explicit_port_and_skip_it_on_the_next_allocation', async () => {
    const allocator = new SqlitePortAllocator(db);

    await allocator.claimScgiPort(ScgiPort.parse(51101));
    await allocator.claimRtorrentPort(RtorrentPort.parse(45000));

    // the migration preserves legacy ports; later allocations must step over them
    expect((await allocator.allocateScgiPort()).value).toBe(51102);
    expect((await allocator.allocateRtorrentPort()).value).toBe(45001);
  });

  it('should_reject_claiming_an_already_taken_port', async () => {
    const allocator = new SqlitePortAllocator(db);
    await allocator.allocateScgiPort(); // takes 51101

    await expect(allocator.claimScgiPort(ScgiPort.parse(51101))).rejects.toThrow(
      PortAlreadyClaimedError,
    );
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

  it('should_dedupe_identical_pending_jobs_on_enqueue_unique', async () => {
    const queue = new SqliteJobQueue(db);

    const first = await queue.enqueueUnique(parseJob('send-mails', {}));
    const second = await queue.enqueueUnique(parseJob('send-mails', {}));

    // scheduler idempotence: a stopped worker never accumulates a backlog
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    const count = db.raw
      .prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'send-mails'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('should_enqueue_unique_again_once_the_pending_job_is_claimed', async () => {
    const queue = new SqliteJobQueue(db);
    await queue.enqueueUnique(parseJob('send-mails', {}));
    await queue.claimNextPending(); // running now — a new tick must re-enqueue

    const again = await queue.enqueueUnique(parseJob('send-mails', {}));

    expect(again).toBeDefined();
  });

  it('should_not_dedupe_jobs_with_different_payloads', async () => {
    const queue = new SqliteJobQueue(db);

    await queue.enqueueUnique(parseJob('suspend-user', { username: 'alice' }));
    const other = await queue.enqueueUnique(parseJob('suspend-user', { username: 'bob' }));

    expect(other).toBeDefined();
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

describe('SqliteTorrentInstanceRepository', () => {
  it('should_roundtrip_an_instance_with_watch_dirs_and_flags', async () => {
    const repo = new SqliteTorrentInstanceRepository(db);
    const { instance } = TorrentInstance.provision({
      username: Username.parse('alice'),
      scgiPort: ScgiPort.parse(51101),
      rtorrentPort: RtorrentPort.parse(45001),
    });
    const withDirs = instance
      .addWatchDir(Label.parse('films'))
      .instance.addWatchDir(Label.parse('series')).instance;

    await repo.save(withDirs.setAllowPublicTracker(true));
    const found = await repo.findByUsername(Username.parse('alice'));

    expect(found?.scgiPort.value).toBe(51101);
    expect(found?.rtorrentPort.value).toBe(45001);
    expect(found?.allowPublicTracker).toBe(true);
    expect(found?.syncDisabled).toBe(false);
    expect(found?.watchDirs.map((dir) => dir.label?.value)).toEqual([
      undefined,
      'films',
      'series',
    ]);
  });

  it('should_update_in_place_on_resave_without_duplicating_watch_dirs', async () => {
    const repo = new SqliteTorrentInstanceRepository(db);
    const { instance } = TorrentInstance.provision({
      username: Username.parse('alice'),
      scgiPort: ScgiPort.parse(51101),
      rtorrentPort: RtorrentPort.parse(45001),
    });
    await repo.save(instance);
    await repo.save(instance.addWatchDir(Label.parse('films')).instance.setSyncDisabled(true));
    await repo.save(instance.addWatchDir(Label.parse('films')).instance.setSyncDisabled(true));

    const found = await repo.findByUsername(Username.parse('alice'));
    expect(found?.syncDisabled).toBe(true);
    expect(found?.watchDirs).toHaveLength(2);
  });

  it('should_delete_the_instance_and_its_watch_dirs', async () => {
    const repo = new SqliteTorrentInstanceRepository(db);
    const { instance } = TorrentInstance.provision({
      username: Username.parse('alice'),
      scgiPort: ScgiPort.parse(51101),
      rtorrentPort: RtorrentPort.parse(45001),
    });
    await repo.save(instance.addWatchDir(Label.parse('films')).instance);

    await repo.delete(Username.parse('alice'));
    await repo.delete(Username.parse('alice')); // idempotent

    expect(await repo.findByUsername(Username.parse('alice'))).toBeUndefined();
    const orphans = db.raw.prepare('SELECT COUNT(*) AS n FROM watch_dirs').get() as { n: number };
    expect(orphans.n).toBe(0);
  });
});

describe('SqliteTorrentRepository', () => {
  const alice = Username.parse('alice');
  const hash = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');

  it('should_upsert_by_username_and_info_hash_through_state_transitions', async () => {
    const repo = new SqliteTorrentRepository(db);
    const loaded = Torrent.load({ infoHash: hash, name: 'x', label: Label.parse('films') });

    await repo.upsert(alice, loaded);
    await repo.upsert(alice, loaded.complete('/home/alice/rtorrent/complete/films/x'));

    const found = await repo.findByInfoHash(alice, hash);
    expect(found?.state.value).toBe('completed');
    expect(found?.tree).toBe('/home/alice/rtorrent/complete/films/x');
    expect(found?.label?.value).toBe('films');
    expect(await repo.listFor(alice)).toHaveLength(1);
  });

  it('should_scope_torrents_by_user', async () => {
    const repo = new SqliteTorrentRepository(db);
    await repo.upsert(alice, Torrent.load({ infoHash: hash, name: 'x' }));
    await repo.upsert(Username.parse('bob'), Torrent.load({ infoHash: hash, name: 'x' }));

    expect(await repo.listFor(alice)).toHaveLength(1);
    expect(await repo.findByInfoHash(Username.parse('bob'), hash)).toBeDefined();

    await repo.delete(alice, hash);
    expect(await repo.findByInfoHash(alice, hash)).toBeUndefined();
    expect(await repo.findByInfoHash(Username.parse('bob'), hash)).toBeDefined();
  });

  it('should_delete_all_torrents_for_a_user', async () => {
    const repo = new SqliteTorrentRepository(db);
    await repo.upsert(alice, Torrent.load({ infoHash: hash, name: 'x' }));
    await repo.upsert(
      alice,
      Torrent.load({
        infoHash: InfoHash.parse('b1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'),
        name: 'y',
      }),
    );

    await repo.deleteAllFor(alice);

    expect(await repo.listFor(alice)).toHaveLength(0);
  });
});

function discoveredTracker(host = 'tracker.example.org'): Tracker {
  return Tracker.discover({
    host: TrackerHost.parse(host),
    proto: TrackerProto.parse('https'),
    port: TrackerPort.parse(443),
    privacy: TrackerPrivacy.parse('private'),
  }).tracker;
}

describe('SqliteTrackerRepository', () => {
  it('should_roundtrip_a_tracker_with_its_addresses', async () => {
    const repo = new SqliteTrackerRepository(db);
    const tracker = discoveredTracker().updateAddresses([
      IpAddress.parse('192.0.2.11'),
      IpAddress.parse('192.0.2.10'),
    ]);

    await repo.save(tracker);
    const found = await repo.findByHost(TrackerHost.parse('tracker.example.org'));

    expect(found?.proto.value).toBe('https');
    expect(found?.port.value).toBe(443);
    expect(found?.privacy.value).toBe('private');
    expect(found?.isActive).toBe(true);
    expect(found?.checkState.value).toBe('pending');
    expect(found?.ipv4.map((ip) => ip.value).sort()).toEqual(['192.0.2.10', '192.0.2.11']);
  });

  it('should_persist_check_transitions_and_promotion', async () => {
    const repo = new SqliteTrackerRepository(db);
    await repo.save(discoveredTracker());

    const pending = await repo.findByHost(TrackerHost.parse('tracker.example.org'));
    if (!pending) throw new Error('expected tracker');
    await repo.save(
      pending.beginCheck().completeCheck({
        promoted: true,
        expiry: CertExpiry.on('2026-09-15'),
        at: '2026-07-24 10:00:00',
      }),
    );

    const found = await repo.findByHost(TrackerHost.parse('tracker.example.org'));
    expect(found?.isSsl).toBe(true);
    expect(found?.certExpiry?.value).toBe('2026-09-15');
    expect(found?.lastCheck).toBe('2026-07-24 10:00:00');
    expect(found?.checkState.value).toBe('none');
  });

  it('should_upsert_by_host_and_replace_addresses_wholesale', async () => {
    const repo = new SqliteTrackerRepository(db);
    await repo.save(discoveredTracker().updateAddresses([IpAddress.parse('192.0.2.10')]));
    await repo.save(discoveredTracker().updateAddresses([IpAddress.parse('192.0.2.12')]));

    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.ipv4.map((ip) => ip.value)).toEqual(['192.0.2.12']);
  });

  it('should_list_only_trackers_needing_a_cert_check', async () => {
    const repo = new SqliteTrackerRepository(db);
    await repo.save(discoveredTracker('pending.example.org'));
    const promoted = discoveredTracker('due.example.org').beginCheck().completeCheck({
      promoted: true,
      expiry: CertExpiry.on('2026-07-25'),
      at: '2026-07-01 10:00:00',
    });
    await repo.save(promoted);
    const notDue = discoveredTracker('fresh.example.org').beginCheck().completeCheck({
      promoted: true,
      expiry: CertExpiry.on('2026-12-31'),
      at: '2026-07-01 10:00:00',
    });
    await repo.save(notDue);

    const hosts = (await repo.listNeedingCertCheck('2026-07-24')).map((t) => t.host.value).sort();
    expect(hosts).toEqual(['due.example.org', 'pending.example.org']);
  });

  it('should_mark_dead_persistently', async () => {
    const repo = new SqliteTrackerRepository(db);
    await repo.save(discoveredTracker().markDead().tracker);

    const found = await repo.findByHost(TrackerHost.parse('tracker.example.org'));
    expect(found?.isDead).toBe(true);
    expect(found?.isActive).toBe(false);
  });
});

describe('SqliteBlocklistRepository', () => {
  const level1 = () =>
    Blocklist.create({
      source: BlocklistSource.parse('iblocklist'),
      author: 'Example Org',
      name: 'level1',
      url: BlocklistUrl.parse('https://list.example.org/?list=abc'),
      subscription: false,
      enabled: true,
    });

  it('should_roundtrip_a_blocklist_with_tagged_update_state', async () => {
    const repo = new SqliteBlocklistRepository(db);
    await repo.save(level1().recordSuccess('2026-07-24 10:00:00', 'deadbeef'));

    const found = await repo.findBySourceAuthorName(
      BlocklistSource.parse('iblocklist'),
      'Example Org',
      'level1',
    );
    expect(found?.lastUpdate).toEqual({ status: 'ok', at: '2026-07-24 10:00:00' });
    expect(found?.sha256).toBe('deadbeef');

    await repo.save(found?.recordFailure() ?? level1());
    const failed = await repo.findBySourceAuthorName(
      BlocklistSource.parse('iblocklist'),
      'Example Org',
      'level1',
    );
    expect(failed?.lastUpdate).toEqual({ status: 'failed' });
    expect(failed?.sha256).toBe('deadbeef');
  });

  it('should_upsert_by_source_author_name_and_list_enabled_only', async () => {
    const repo = new SqliteBlocklistRepository(db);
    await repo.save(level1());
    await repo.save(level1().disable());
    await repo.save(
      Blocklist.create({
        source: BlocklistSource.parse('personal'),
        author: 'me',
        name: 'mine',
        url: BlocklistUrl.parse('https://lists.example.net/mine.gz'),
        subscription: false,
        enabled: true,
      }),
    );

    expect(await repo.listAll()).toHaveLength(2);
    const enabled = await repo.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.name).toBe('mine');
  });
});

describe('SqliteUserAddressRepository', () => {
  it('should_add_list_and_remove_addresses_idempotently', async () => {
    const repo = new SqliteUserAddressRepository(db);
    const alice = Username.parse('alice');
    await repo.add(alice, IpAddress.parse('198.51.100.7'));
    await repo.add(alice, IpAddress.parse('198.51.100.7')); // duplicate: no-op
    await repo.add(Username.parse('bob'), IpAddress.parse('198.51.100.8'));

    const all = await repo.listAll();
    expect(all).toHaveLength(2);

    await repo.remove(alice, IpAddress.parse('198.51.100.7'));
    await repo.remove(alice, IpAddress.parse('198.51.100.7')); // idempotent
    expect((await repo.listAll()).map((a) => a.username.value)).toEqual(['bob']);
  });

  it('should_expose_hostname_rows_to_the_whitelist_only_once_resolved', async () => {
    const repo = new SqliteUserAddressRepository(db);
    const alice = Username.parse('alice');
    const host = DynDnsHost.parse('dyn.example.org');

    await repo.addHostname(alice, host);
    await repo.addHostname(alice, host); // duplicate: no-op
    expect(await repo.listAll()).toHaveLength(0); // unresolved yet

    const bindings = await repo.listHostnames();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.host.value).toBe('dyn.example.org');
    expect(bindings[0]?.resolvedIp).toBeUndefined();

    await repo.updateResolvedIp(alice, host, IpAddress.parse('203.0.113.9'));
    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.ip.value).toBe('203.0.113.9');
    expect((await repo.listHostnames())[0]?.resolvedIp?.value).toBe('203.0.113.9');
  });

  it('should_absorb_a_static_row_when_a_hostname_resolves_to_the_same_ip', async () => {
    // the static -> dyndns migration path: without absorption the UNIQUE
    // (username, ipv4) constraint would fail resolve-dyndns forever
    const repo = new SqliteUserAddressRepository(db);
    const alice = Username.parse('alice');
    const host = DynDnsHost.parse('dyn.example.org');
    await repo.add(alice, IpAddress.parse('203.0.113.9'));
    await repo.addHostname(alice, host);

    await repo.updateResolvedIp(alice, host, IpAddress.parse('203.0.113.9'));

    const all = await repo.listAll();
    expect(all).toHaveLength(1); // the hostname row carries the address now
    expect((await repo.listHostnames())[0]?.resolvedIp?.value).toBe('203.0.113.9');
  });

  it('should_remove_hostname_bindings_idempotently', async () => {
    const repo = new SqliteUserAddressRepository(db);
    const alice = Username.parse('alice');
    const host = DynDnsHost.parse('dyn.example.org');
    await repo.addHostname(alice, host);
    await repo.updateResolvedIp(alice, host, IpAddress.parse('203.0.113.9'));

    await repo.removeHostname(alice, host);
    await repo.removeHostname(alice, host); // idempotent
    expect(await repo.listHostnames()).toHaveLength(0);
    expect(await repo.listAll()).toHaveLength(0);
  });
});

describe('SqliteFairUseRepository', () => {
  it('should_default_to_a_clean_state_and_roundtrip_transitions', async () => {
    const repo = new SqliteFairUseRepository(db);
    const alice = Username.parse('alice');

    expect(await repo.getState(alice)).toEqual({ level: 'none', healthState: 'healthy' });

    await repo.saveState(alice, { level: 'alerted', healthState: 'healthy' }, '2026-07-24 10:00:00');
    await repo.saveState(alice, { level: 'throttled', healthState: 'unhealthy' }, '2026-07-24 10:05:00');
    expect(await repo.getState(alice)).toEqual({ level: 'throttled', healthState: 'unhealthy' });
  });

  it('should_append_an_immutable_audit_trail', async () => {
    const repo = new SqliteFairUseRepository(db);
    const alice = Username.parse('alice');

    await repo.appendEvent(alice, 'FairUseBreached', '{"observedBps":80000000}', '2026-07-24 10:00:00');
    await repo.appendEvent(alice, 'UserThrottled', '{"rateBps":5000000}', '2026-07-24 10:05:00');
    await repo.appendEvent(Username.parse('bob'), 'FairUseRecovered', '{}', '2026-07-24 11:00:00');

    const events = await repo.listEvents(alice);
    expect(events.map((e) => e.eventType)).toEqual(['FairUseBreached', 'UserThrottled']);
    expect(events[0]?.detailJson).toContain('80000000');
  });

  it('should_return_per_user_policy_overrides_only_when_set', async () => {
    const repo = new SqliteFairUseRepository(db);
    const alice = Username.parse('alice');

    expect(await repo.overridesFor(alice)).toBeUndefined();

    await repo.saveOverrides(alice, { maxAuthPerHour: 120 });
    const overrides = await repo.overridesFor(alice);
    expect(overrides?.maxAuthPerHour).toBe(120);
    expect(overrides?.sustainedEgress).toBeUndefined();

    await repo.saveOverrides(alice, { sustainedEgress: Bandwidth.mbit(100) });
    expect((await repo.overridesFor(alice))?.sustainedEgress?.bps).toBe(100_000_000);
  });

  it('should_roundtrip_usage_samples_per_user', async () => {
    const repo = new SqliteFairUseRepository(db);
    const alice = Username.parse('alice');

    expect(await repo.lastSample(alice)).toBeUndefined();

    await repo.putSample(alice, { egressBytes: 1000, ingressBytes: 200, sampledAt: '2026-07-24 10:00:00' });
    await repo.putSample(alice, { egressBytes: 5000, ingressBytes: 900, sampledAt: '2026-07-24 10:05:00' });
    expect(await repo.lastSample(alice)).toEqual({
      egressBytes: 5000,
      ingressBytes: 900,
      sampledAt: '2026-07-24 10:05:00',
    });
  });
});

describe('SqliteComponentRegistry', () => {
  const now = '2026-07-24 12:00:00';

  it('should_default_every_component_to_absent_and_round_trip_state_transitions', async () => {
    const registry = new SqliteComponentRegistry(db);
    const nginx = ComponentName.parse('nginx');

    expect(await registry.get(nginx)).toBeUndefined();
    expect((await registry.states()).size).toBe(0);

    await registry.markInstalled(nginx, Version.parse('1.22.1-9'), now);
    const installed = await registry.get(nginx);
    expect(installed?.state.value).toBe('installed');
    expect(installed?.version?.value).toBe('1.22.1-9');
    expect(installed?.installedAt).toBe(now);

    expect((await registry.states()).get('nginx')?.value).toBe('installed');
  });

  it('should_record_failures_with_reason_and_let_a_re_run_mark_installed', async () => {
    const registry = new SqliteComponentRegistry(db);
    const bind = ComponentName.parse('bind');

    await registry.markFailed(bind, 'named-checkconf exited 1', now);
    const failed = await registry.get(bind);
    expect(failed?.state.value).toBe('failed');
    expect(failed?.reason).toBe('named-checkconf exited 1');

    await registry.markInstalled(bind, undefined, '2026-07-24 12:30:00');
    const recovered = await registry.get(bind);
    expect(recovered?.state.value).toBe('installed');
    expect(recovered?.reason).toBeUndefined();
  });

  it('should_list_every_component_row_for_the_status_view', async () => {
    const registry = new SqliteComponentRegistry(db);
    await registry.markInstalled(ComponentName.parse('nginx'), Version.parse('1.22.1-9'), now);
    await registry.markSkipped(ComponentName.parse('dnscrypt'), 'not packaged', now);

    const rows = await registry.list();

    expect(rows.map((row) => [row.name.value, row.state.value])).toEqual([
      ['dnscrypt', 'skipped'],
      ['nginx', 'installed'],
    ]);
  });

  it('should_record_skips_with_reason_and_reset_back_to_to_install', async () => {
    const registry = new SqliteComponentRegistry(db);
    const dnscrypt = ComponentName.parse('dnscrypt');

    await registry.markSkipped(dnscrypt, 'dnscrypt-proxy not packaged for Debian 12', now);
    expect((await registry.get(dnscrypt))?.state.value).toBe('skipped');

    await registry.reset(dnscrypt, '2026-07-24 13:00:00');
    expect((await registry.get(dnscrypt))?.state.value).toBe('to_install');
  });
});
