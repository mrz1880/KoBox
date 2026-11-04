import { describe, expect, it } from 'vitest';
import { departureOfRequeued } from '../../../../src/domain/sync/Departure.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { SyncMode } from '../../../../src/domain/torrent/SyncMode.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';

const films = Label.parse('Films');

function aliceWithFilms(mode: SyncMode): TorrentInstance {
  const provisioned = TorrentInstance.provision({
    username: Username.parse('alice'),
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45000),
  }).instance;
  return provisioned.addWatchDir(films).instance.setSyncMode(films, mode);
}

describe('departureOfRequeued', () => {
  it('should_send_a_transfer_put_back_from_a_folder_that_sends_straight_away_at_once', () => {
    expect(departureOfRequeued(aliceWithFilms(SyncMode.immediate), films)).toBe('straight-away');
  });

  // the hourly pass always comes, so nothing is stranded; going out at once is
  // only for a folder its owner still asks to send straight away
  it.each([
    ['a scheduled folder', aliceWithFilms(SyncMode.scheduled), films],
    ['a folder set to stay here since', aliceWithFilms(SyncMode.off), films],
    ['a folder that no longer exists', aliceWithFilms(SyncMode.immediate), Label.parse('Docs')],
    ['a member without folders at all', undefined, films],
  ])('should_wait_for_the_members_hour_for_%s', (_case, folders, label) => {
    expect(departureOfRequeued(folders, label)).toBe('at-send-hour');
  });
});
