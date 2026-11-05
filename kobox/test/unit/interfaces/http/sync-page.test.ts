import { describe, expect, it } from 'vitest';
import { Language } from '../../../../src/domain/portal/Language.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { SendHour } from '../../../../src/domain/sync/SendHour.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { SyncMode } from '../../../../src/domain/torrent/SyncMode.js';
import { WatchDir } from '../../../../src/domain/torrent/WatchDir.js';
import { Username } from '../../../../src/domain/user/Username.js';
import type { Viewer } from '../../../../src/interfaces/http/views/layout.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';
import { syncPage } from '../../../../src/interfaces/http/views/syncPage.js';

function memberReading(language: Language): Viewer {
  return {
    language,
    t: translatorFor(language),
    zone: 'Europe/Paris',
    username: 'alice',
    role: 'user',
    csrfToken: 'csrf',
  };
}

function sendingAt(hour: number): SyncDestination {
  return SyncDestination.define({
    username: Username.parse('alice'),
    host: RemoteHost.parse('nas.example.org'),
    port: RemotePort.parse(22),
    account: RemoteAccount.parse('seedbox'),
    sealedPassword: 'sealed',
    path: RemotePath.parse('/volume1/torrents'),
    batchSize: TransferBatchSize.unlimited(),
    placement: LoneFilePlacement.besideTheOthers,
    sendHour: SendHour.parse(hour),
  });
}

const laterFolder = { categories: [WatchDir.labeled(Label.parse('films'), SyncMode.scheduled)], holding: new Set<string>() };

describe('the folders page', () => {
  // a "bit later" folder waits for the member's send hour, not for a pass
  // minutes away: on 2026-11-04 the page promised the latter
  it('should_say_a_bit_later_folder_waits_for_the_hour_the_member_chose', () => {
    const page = syncPage(laterFolder, sendingAt(23), [], memberReading(Language.en));

    expect(page).toContain('It waits for 23:00, the hour set below for these folders, and goes out then.');
    expect(page).not.toContain('a few minutes after it finishes');
  });

  it('should_say_so_in_french_to_a_french_member', () => {
    const page = syncPage(laterFolder, sendingAt(23), [], memberReading(Language.fr));

    expect(page).toContain('Il attend 23:00, l’heure réglée plus bas pour ces dossiers, et part à ce moment-là.');
  });

  it('should_name_the_default_hour_before_any_destination_is_set', () => {
    const page = syncPage(laterFolder, undefined, [], memberReading(Language.en));

    expect(page).toContain('It waits for 02:00,');
  });
});
