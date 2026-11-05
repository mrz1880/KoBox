import { describe, expect, it } from 'vitest';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { carriedBy, immediatePassFor, SCHEDULED_PASS } from '../../../../src/domain/sync/SendPass.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { SyncMode } from '../../../../src/domain/torrent/SyncMode.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';

const alice = Username.parse('alice');
const films = Label.parse('Films');
const series = Label.parse('Series');

// alice sends Films straight away and Series at her send hour
function aliceFolders(): TorrentInstance {
  const provisioned = TorrentInstance.provision({
    username: alice,
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45000),
  }).instance;
  return provisioned
    .addWatchDir(films)
    .instance.setSyncMode(films, SyncMode.immediate)
    .addWatchDir(series)
    .instance.setSyncMode(series, SyncMode.scheduled);
}

function waitingIn(label: Label, name: string): SyncTransfer {
  return SyncTransfer.queue({
    username: alice,
    label,
    source: LocalPath.parse(`/home/alice/rtorrent/complete/${label.value}/${name}`),
    queuedAt: '2026-11-05 10:00:00',
  });
}

const film = waitingIn(films, 'Some.Film.mkv');
const episode = waitingIn(series, 'Some.Episode.mkv');

describe('carriedBy', () => {
  // the member chose to keep the link free until their hour for Series: a
  // film finishing must not drag the episodes out with it
  it('should_carry_only_what_a_straight_away_folder_holds_on_an_immediate_pass', () => {
    expect(carriedBy(immediatePassFor(alice), [film, episode], aliceFolders())).toEqual([film]);
  });

  // once the member's hour has come, whatever waits goes, straight-away
  // folders included: nothing is ever stranded by a mode changed since
  it('should_carry_everything_waiting_on_the_scheduled_pass', () => {
    expect(carriedBy(SCHEDULED_PASS, [film, episode], aliceFolders())).toEqual([film, episode]);
  });
});
