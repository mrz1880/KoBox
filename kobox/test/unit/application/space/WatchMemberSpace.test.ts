import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../../../../src/application/jobs/contract.js';
import type { JobQueuePort } from '../../../../src/application/jobs/JobQueuePort.js';
import { WatchMemberSpace } from '../../../../src/application/space/WatchMemberSpace.js';
import { CleanupCandidate, type CleanupReason } from '../../../../src/domain/space/CleanupCandidate.js';
import { SeedRule } from '../../../../src/domain/space/SeedRule.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import type { SeedboxUser } from '../../../../src/domain/user/SeedboxUser.js';
import { InMemoryCleanupSnapshotRepository } from '../../../../src/infrastructure/persistence/InMemoryCleanupSnapshotRepository.js';
import { InMemoryMailOutbox } from '../../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemorySpacePreferenceRepository } from '../../../../src/infrastructure/persistence/InMemorySpacePreferenceRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { aUser } from '../../../builders/UserBuilder.js';

class RecordingQueue implements Pick<JobQueuePort, 'enqueue'> {
  readonly jobs: Job[] = [];

  enqueue(job: Job): Promise<number> {
    this.jobs.push(job);
    return Promise.resolve(this.jobs.length);
  }
}

const BASE = 'https://box.example.org';
// the worker's clock: a stamp, UTC to the second
const AT = '2026-11-20 12:00:00';
// the next hourly pass
const LATER = '2026-11-20 13:00:00';
const ALLOWANCE = Quota.gib(100);
const PAST_CRITICAL = Quota.gib(95);

function candidate(hashChar: string, reason: CleanupReason, size: Quota): CleanupCandidate {
  return CleanupCandidate.restore({
    infoHash: InfoHash.parse(hashChar.repeat(40)),
    name: `Example ${hashChar}`,
    size,
    ratio: 3,
    finishedAt: '2026-10-01T08:00:00.000Z',
    path: `/home/alice/rtorrent/complete/Example ${hashChar}`,
    reason,
  });
}

let alice: SeedboxUser;
let preferences: InMemorySpacePreferenceRepository;
let snapshots: InMemoryCleanupSnapshotRepository;
let outbox: InMemoryMailOutbox;
let credentials: InMemoryPortalCredentialsRepository;
let queue: RecordingQueue;
let watch: WatchMemberSpace;

beforeEach(async () => {
  alice = aUser().withQuota(ALLOWANCE).build();
  const users = new InMemoryUserRepository();
  await users.save(alice);
  preferences = new InMemorySpacePreferenceRepository();
  snapshots = new InMemoryCleanupSnapshotRepository();
  outbox = new InMemoryMailOutbox();
  credentials = new InMemoryPortalCredentialsRepository();
  queue = new RecordingQueue();
  watch = new WatchMemberSpace({
    preferences,
    snapshots,
    queue,
    mail: {
      users,
      credentials,
      address: { baseUrl: () => Promise.resolve(BASE) },
      outbox,
    },
  });
});

describe('WatchMemberSpace', () => {
  it('should_mail_a_member_past_the_critical_line_what_they_can_free_and_where', async () => {
    await snapshots.replace(alice.username, [candidate('A', 'seeded', Quota.gib(20))], AT, SeedRule.DEFAULT);

    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);

    const mails = await outbox.listRecent(10);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.recipient).toBe('alice@example.org');
    expect(mails[0]?.body).toContain('95 %');
    expect(mails[0]?.body).toContain('20,0 Gio');
    expect(mails[0]?.body).toContain(`${BASE}/space/cleanup`);
    expect(queue.jobs).toEqual([]);
  });

  it('should_not_mail_again_while_the_member_stays_past_the_line', async () => {
    await snapshots.replace(alice.username, [candidate('A', 'seeded', Quota.gib(20))], AT, SeedRule.DEFAULT);

    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);
    await watch.execute({ user: alice, used: PAST_CRITICAL }, LATER);

    expect(await outbox.listRecent(10)).toHaveLength(1);
  });

  it('should_tell_a_member_with_nothing_to_clean_to_delete_by_hand_or_ask_for_more', async () => {
    await snapshots.replace(alice.username, [], AT, SeedRule.DEFAULT);

    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);

    const [mail] = await outbox.listRecent(10);
    expect(mail?.body).toContain('Rien ne peut être nettoyé');
    expect(mail?.body).toContain("demande plus d'espace");
    expect(mail?.body).not.toContain('Tu peux libérer');
  });

  it('should_clean_up_for_a_member_who_chose_it_only_what_their_choice_covers', async () => {
    await preferences.chooseAutomatic(alice.username, 'sentOnly');
    await snapshots.replace(
      alice.username,
      [candidate('A', 'alreadySent', Quota.gib(10)), candidate('B', 'seeded', Quota.gib(20))],
      AT,
      SeedRule.DEFAULT,
    );

    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);

    expect(queue.jobs).toEqual([
      {
        type: 'clean-up-space',
        payload: { username: 'alice', infoHashes: ['A'.repeat(40)], trigger: 'automatic' },
      },
    ]);
    expect(await outbox.listRecent(10)).toEqual([]);
  });

  it('should_mail_rather_than_clean_up_from_a_list_older_than_two_hours', async () => {
    // rTorrent stopped answering: the list kept is from before the last two passes
    await preferences.chooseAutomatic(alice.username, 'sentOnly');
    await snapshots.replace(
      alice.username,
      [candidate('A', 'alreadySent', Quota.gib(10))],
      '2026-11-20 09:59:59',
      SeedRule.DEFAULT,
    );

    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);

    expect(queue.jobs).toEqual([]);
    expect(await outbox.listRecent(10)).toHaveLength(1);
  });

  it('should_mail_a_member_who_chose_automatic_cleanup_when_nothing_it_covers_can_go', async () => {
    // only seeded torrents, and the member only lets KoBox delete what it sent
    await preferences.chooseAutomatic(alice.username, 'sentOnly');
    await snapshots.replace(alice.username, [candidate('B', 'seeded', Quota.gib(20))], AT, SeedRule.DEFAULT);

    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);

    expect(queue.jobs).toEqual([]);
    const [mail] = await outbox.listRecent(10);
    expect(mail?.body).toContain('20,0 Gio');
  });

  it('should_not_clean_up_again_every_hour_while_a_cleanup_left_the_member_past_the_line', async () => {
    await preferences.chooseAutomatic(alice.username, 'sentOnly');
    await snapshots.replace(alice.username, [candidate('A', 'alreadySent', Quota.gib(1))], AT, SeedRule.DEFAULT);
    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);
    // the cleanup freed 1 GiB, not enough to go back under the line
    await snapshots.replace(alice.username, [candidate('C', 'alreadySent', Quota.gib(1))], LATER, SeedRule.DEFAULT);

    await watch.execute({ user: alice, used: Quota.gib(94) }, LATER);

    expect(queue.jobs).toHaveLength(1);
    expect(await outbox.listRecent(10)).toEqual([]);
  });

  it('should_clean_up_again_once_the_member_went_back_under_the_line_and_climbed_anew', async () => {
    await preferences.chooseAutomatic(alice.username, 'sentOnly');
    await snapshots.replace(alice.username, [candidate('A', 'alreadySent', Quota.gib(20))], AT, SeedRule.DEFAULT);
    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);
    await watch.execute({ user: alice, used: Quota.gib(75) }, LATER);
    await snapshots.replace(alice.username, [candidate('C', 'alreadySent', Quota.gib(20))], LATER, SeedRule.DEFAULT);

    await watch.execute({ user: alice, used: PAST_CRITICAL }, LATER);

    expect(queue.jobs.map((job) => job.payload)).toEqual([
      { username: 'alice', infoHashes: ['A'.repeat(40)], trigger: 'automatic' },
      { username: 'alice', infoHashes: ['C'.repeat(40)], trigger: 'automatic' },
    ]);
  });

  it('should_write_to_a_member_who_chose_english_in_english', async () => {
    await credentials.save(
      { username: alice.username, role: 'user', language: Language.en },
      AT,
    );
    await snapshots.replace(alice.username, [], AT, SeedRule.DEFAULT);

    await watch.execute({ user: alice, used: PAST_CRITICAL }, AT);

    const [mail] = await outbox.listRecent(10);
    expect(mail?.subject).toBe('Your seedbox is almost full');
    expect(mail?.body).toContain('Nothing can be cleaned for now');
  });
});
