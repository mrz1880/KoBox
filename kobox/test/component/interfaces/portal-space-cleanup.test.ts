import { beforeEach, describe, expect, it } from 'vitest';
import { CleanupCandidate, type CleanupReason } from '../../../src/domain/space/CleanupCandidate.js';
import { CleanupReport, type SkipReason } from '../../../src/domain/space/CleanupReport.js';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { Quota } from '../../../src/domain/user/Quota.js';
import { VolumeSpace } from '../../../src/domain/user/VolumeSpace.js';
import { Username } from '../../../src/domain/user/Username.js';
import { buildPortalWorld, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

const alice = Username.parse('alice');
// the hourly pass, forty minutes before the world's clock (10:00 UTC)
const TAKEN_AT = '2026-07-25 09:20:00';

const SEEDED = 'A'.repeat(40);
const SENT = 'B'.repeat(40);
const SMALL = 'C'.repeat(40);

function candidate(
  hash: string,
  name: string,
  sizeGib: number,
  reason: CleanupReason,
  finishedAt = '2026-07-13T08:00:00.000Z',
): CleanupCandidate {
  return CleanupCandidate.restore({
    infoHash: InfoHash.parse(hash),
    name,
    size: Quota.gib(sizeGib),
    ratio: 2.4,
    finishedAt,
    path: `/home/alice/rtorrent/complete/${name}`,
    reason,
  });
}

// alice's allowance is 412 GiB: at 400 GiB, the two largest bring her back
// under the 80 % line (329.6 GiB) and the third stays unchecked
async function snapshotWithThreeCandidates(): Promise<void> {
  await world.diskSamples.save({ username: alice, used: Quota.gib(400), sampledAt: TAKEN_AT });
  await world.cleanupSnapshots.replace(
    alice,
    [
      candidate(SMALL, 'Small.Release', 10, 'seeded'),
      candidate(SEEDED, 'Big.Release', 50, 'seeded'),
      candidate(SENT, 'Sent.Release', 30, 'alreadySent'),
    ],
    TAKEN_AT,
  );
}

async function homeOf(session: AgentSession, language = 'en'): Promise<string> {
  const response = await world.server.inject({
    method: 'GET',
    url: '/',
    headers: { cookie: session.cookie, 'accept-language': language },
  });
  return response.body;
}

// alice's usage, and a disk with room to spare
async function measured(usedGib: number): Promise<void> {
  await world.diskSamples.save({ username: alice, used: Quota.gib(usedGib), sampledAt: TAKEN_AT });
  await world.volumeSamples.save({
    space: VolumeSpace.of({ free: Quota.gib(2000), size: Quota.gib(3200) }),
    measuredAt: TAKEN_AT,
  });
}

const DISCREET_LINK = '<p class="muted"><a href="/space/cleanup">See what can be cleaned</a></p>';

// each box of the form, in page order, with whether it is checked
function boxesOf(body: string): string[] {
  return [...body.matchAll(/name="pick" value="([0-9A-F]{40})"( checked)?/g)].map(
    ([, hash, checked]) => `${hash?.charAt(0) ?? ''}${checked === undefined ? '' : ' checked'}`,
  );
}

let world: PortalWorld;
let member: AgentSession;

async function cleanupPageOf(session: AgentSession, language = 'en'): Promise<string> {
  const response = await world.server.inject({
    method: 'GET',
    url: '/space/cleanup',
    headers: { cookie: session.cookie, 'accept-language': language },
  });
  return response.body;
}

// the form as the browser sends it, with one `pick` per checked box
function picked(session: AgentSession, hashes: readonly string[]): string {
  return [`_csrf=${session.csrf}`, ...hashes.map((hash) => `pick=${hash}`)].join('&');
}

async function submit(url: string, payload: string): Promise<{ status: number; body: string; location: string }> {
  const response = await world.server.inject({
    method: 'POST',
    url,
    payload,
    headers: { cookie: member.cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  return {
    status: response.statusCode,
    body: response.body,
    location: response.headers.location ?? '',
  };
}

beforeEach(async () => {
  world = await buildPortalWorld();
  member = await loginAs(world, 'alice');
});

describe('the cleanup page', () => {
  // the hourly pass has not judged the member's torrents yet
  it('should_say_the_first_list_arrives_within_the_hour_before_any_snapshot', async () => {
    expect(await cleanupPageOf(member)).toContain('The first list arrives within the hour.');
  });

  it('should_say_there_is_nothing_to_clean_while_the_torrents_still_seed', async () => {
    await world.cleanupSnapshots.replace(alice, [], TAKEN_AT);

    expect(await cleanupPageOf(member)).toContain(
      'Nothing to clean yet: your torrents are still seeding.',
    );
  });

  it('should_check_the_largest_lines_until_the_member_is_back_under_the_line', async () => {
    await snapshotWithThreeCandidates();

    const body = await cleanupPageOf(member);

    expect(boxesOf(body)).toEqual(['A checked', 'B checked', 'C']);
    expect(body).toContain('Delete for good (80 GiB)');
  });

  // finished on July 13, listed on July 25: twelve whole days of seeding
  it('should_say_of_each_line_its_size_ratio_finish_and_why_it_may_go', async () => {
    await snapshotWithThreeCandidates();

    const body = await cleanupPageOf(member);

    expect(body).toContain(
      '<td class="path">Big.Release</td>\n  <td class="num">50 GiB</td>\n  <td class="num ratio">2.4</td>\n  <td class="when finished">Jul 13, 2026</td>\n  <td class="reason">Ratio 2.4 after 12 days<br>',
    );
    expect(body).toContain('<td class="reason">Already sent to your machine</td>');
  });

  // KoBox only knows what its own sync sent: a seeded line may never have
  // reached the member's machine, a sent one has
  it('should_say_kobox_does_not_know_whether_a_seeded_torrent_was_fetched', async () => {
    await snapshotWithThreeCandidates();

    const body = await cleanupPageOf(member);

    expect(body).toContain(
      '<td class="reason">Ratio 2.4 after 12 days<br><span class="muted">KoBox does not know whether you fetched it.</span></td>',
    );
    expect(body).toContain('<td class="reason">Already sent to your machine</td>');
  });

  // a box whose rule asks for a single day
  it('should_say_one_day_rather_than_one_days', async () => {
    await world.cleanupSnapshots.replace(
      alice,
      [candidate(SEEDED, 'Big.Release', 50, 'seeded', '2026-07-24T08:00:00.000Z')],
      TAKEN_AT,
    );

    expect(await cleanupPageOf(member)).toContain('Ratio 2.4 after 1 day<');
  });

  // the list is an hour old at most: the member knows what it reflects
  it('should_say_when_the_list_was_made', async () => {
    await snapshotWithThreeCandidates();

    expect(await cleanupPageOf(member)).toContain('List from July 25, 2026 at 11:20 AM.');
  });

  // the homes are not backed up: the page must not soften it
  it('should_warn_before_the_button_that_the_deletion_cannot_be_undone', async () => {
    await snapshotWithThreeCandidates();

    const body = await cleanupPageOf(member);
    const warning = body.indexOf(
      'The files will be erased from the seedbox for good. This cannot be undone.',
    );

    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(body.indexOf('Delete for good ('));
  });

  // without a script, the total follows the boxes once the member asks for it
  it('should_check_exactly_what_the_member_picked_when_they_recalculate', async () => {
    await snapshotWithThreeCandidates();

    const page = await submit('/space/cleanup/recalculate', picked(member, [SMALL, SEEDED]));

    expect(page.status).toBe(200);
    expect(boxesOf(page.body)).toEqual(['A checked', 'B', 'C checked']);
    expect(page.body).toContain('Delete for good (60 GiB)');
  });
});

describe('deleting from the cleanup page', () => {
  // the worker judges each one again live before deleting it
  it('should_hand_the_picked_torrents_to_the_worker_for_the_session_member', async () => {
    await snapshotWithThreeCandidates();

    const sent = await submit('/space/cleanup', picked(member, [SEEDED, SENT]));

    expect(sent.status).toBe(303);
    expect(sent.location).toBe(
      `/space/cleanup?flash=${encodeURIComponent('Cleanup done. The list and your space are up to date.')}`,
    );
    expect(world.queue.jobs).toEqual([
      { type: 'clean-up-space', payload: { username: 'alice', infoHashes: [SEEDED, SENT] } },
    ]);
  });

  it('should_refuse_a_box_that_is_not_an_info_hash_without_enqueueing', async () => {
    const sent = await submit('/space/cleanup', picked(member, [SEEDED, '../../etc']));

    expect(sent.status).toBe(400);
    expect(world.queue.jobs).toEqual([]);
  });

  it('should_send_the_member_back_when_they_chose_nothing', async () => {
    const sent = await submit('/space/cleanup', picked(member, []));

    expect(sent.status).toBe(303);
    expect(sent.location).toBe(
      `/space/cleanup?flash=${encodeURIComponent('You did not choose anything to delete.')}`,
    );
    expect(world.queue.jobs).toEqual([]);
  });

  it('should_require_csrf_to_delete', async () => {
    const sent = await submit('/space/cleanup', `pick=${SEEDED}`);

    expect(sent.status).toBe(403);
    expect(world.queue.jobs).toEqual([]);
  });
});

describe('what the last cleanup did', () => {
  it('should_say_at_the_top_what_went_and_the_space_it_gave_back', async () => {
    await snapshotWithThreeCandidates();
    await world.cleanupReports.save(
      alice,
      CleanupReport.of({
        deleted: [
          { name: 'Old.Release', size: Quota.gib(50) },
          { name: 'Older.Release', size: Quota.gib(30) },
        ],
        skipped: [],
        at: '2026-07-25 09:30:00',
      }),
    );

    const body = await cleanupPageOf(member);

    expect(body).toContain('July 25, 2026 at 11:30 AM: 80 GiB freed.');
    expect(body).toContain('<td class="path">Old.Release</td>\n  <td class="num">50 GiB</td>');
    expect(body.indexOf('80 GiB freed.')).toBeLessThan(body.indexOf('<h2>What can be deleted</h2>'));
  });

  it.each<[SkipReason, string]>([
    ['noLongerQualifies', 'Kept: it no longer qualifies, it was restarted or is being sent to your machine.'],
    ['gone', 'Already gone from your torrents.'],
    ['notErased', 'Kept: rTorrent refused to let it go, so its files were left alone.'],
    ['dataKept', 'Removed from rTorrent, but its files could not be erased: they are still in your files.'],
  ])('should_say_why_a_torrent_skipped_as_%s_is_still_there', async (reason, said) => {
    await world.cleanupReports.save(
      alice,
      CleanupReport.of({ deleted: [], skipped: [{ name: 'Kept.Release', reason }], at: '2026-07-25 09:30:00' }),
    );

    const body = await cleanupPageOf(member);

    expect(body).toContain('July 25, 2026 at 11:30 AM: nothing was deleted.');
    expect(body).toContain(`<td class="path">Kept.Release</td>\n  <td class="reason">${said}</td>`);
  });
});

describe('the cleanup page in French', () => {
  it('should_say_each_line_and_the_button_in_french', async () => {
    await snapshotWithThreeCandidates();

    const body = await cleanupPageOf(member, 'fr-FR');

    expect(body).toContain('<td class="when finished">13 juil. 2026</td>');
    expect(body).toContain(
      '<td class="reason">Ratio 2,4 après 12 jours<br><span class="muted">KoBox ne sait pas si vous l’avez récupéré.</span></td>',
    );
    expect(body).toContain('Liste du 25 juillet 2026 à 11:20.');
    expect(body).toContain('Supprimer pour de bon (80 Gio)');
  });
});

describe('the home points at the cleanup', () => {
  // 188 of 412 GiB, under the 80 % line: nothing presses
  it('should_offer_a_discreet_link_under_the_filling_line', async () => {
    await measured(188);

    expect(await homeOf(member)).toContain(DISCREET_LINK);
  });

  // 400 of 412 GiB: the two largest lines are what the page would check
  it('should_say_how_much_can_be_freed_once_past_the_filling_line', async () => {
    await measured(400);
    await snapshotWithThreeCandidates();

    const body = await homeOf(member);

    expect(body).toContain('<p><b>80 GiB</b> can be freed.</p>');
    expect(body).toContain('<a class="action" href="/space/cleanup">See and clean</a>');
    expect(body).not.toContain(DISCREET_LINK);
  });

  it('should_say_in_the_box_that_nothing_can_be_cleaned_yet', async () => {
    await measured(400);
    await world.cleanupSnapshots.replace(alice, [], TAKEN_AT);

    const body = await homeOf(member);

    expect(body).toContain(
      '<section class="flash warn">\n<p>Nothing to clean yet: your torrents are still seeding.</p>',
    );
    expect(body).not.toContain('can be freed');
  });

  // a list exists but nobody knows how full the member is: nothing to claim
  it('should_keep_to_the_discreet_link_before_the_first_measure', async () => {
    await snapshotWithThreeCandidates();
    await world.diskSamples.save({ username: Username.parse('boss'), used: Quota.gib(1), sampledAt: TAKEN_AT });

    const body = await homeOf(member);

    expect(body).toContain('Space not measured yet.');
    expect(body).toContain(DISCREET_LINK);
  });

  it('should_point_at_the_cleanup_in_french', async () => {
    await measured(400);
    await snapshotWithThreeCandidates();

    const body = await homeOf(member, 'fr-FR');

    expect(body).toContain('<p><b>80 Gio</b> peuvent être libérés.</p>');
    expect(body).toContain('>Voir et nettoyer</a>');
  });
});
