import { describe, expect, it } from 'vitest';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { Username } from '../../../../src/domain/user/Username.js';

function aDestination(): SyncDestination {
  return SyncDestination.define({
    username: Username.parse('alice'),
    host: RemoteHost.parse('nas.example.org'),
    port: RemotePort.parse(22),
    account: RemoteAccount.parse('seedbox'),
    sealedPassword: 'sealed-blob',
    path: RemotePath.parse('/volume1/torrents'),
    batchSize: TransferBatchSize.unlimited(),
    placement: LoneFilePlacement.besideTheOthers,
  });
}

describe('SyncDestination', () => {
  it('should_put_a_category_in_a_folder_of_its_own_name', () => {
    expect(aDestination().folderFor('films')).toBe('/volume1/torrents/films');
  });

  it('should_give_a_lone_file_its_own_folder_when_that_is_what_was_asked', () => {
    const forScrapers = aDestination().withPlacement(LoneFilePlacement.inItsOwnFolder);

    // Plex and the *arr scrapers want one folder per film; the folder is named
    // after the file, without its extension
    expect(forScrapers.folderForLoneFile('films', 'Some.Film.2024.mkv')).toBe(
      '/volume1/torrents/films/Some.Film.2024',
    );
  });

  it('should_leave_a_lone_file_beside_the_others_by_default', () => {
    expect(aDestination().folderForLoneFile('films', 'Some.Film.2024.mkv')).toBe(
      '/volume1/torrents/films',
    );
  });

  it('should_keep_the_stored_password_when_a_member_edits_everything_else', () => {
    // the form cannot show a password back, so an empty field means "unchanged"
    const moved = aDestination().withConnection({
      host: RemoteHost.parse('nas2.example.org'),
      port: RemotePort.parse(2222),
      account: RemoteAccount.parse('seedbox'),
      path: RemotePath.parse('/volume2/torrents'),
    });

    expect(moved.sealedPassword).toBe('sealed-blob');
    expect(moved.host.value).toBe('nas2.example.org');
  });

  it('should_forget_every_earlier_verdict_when_the_connection_changes', () => {
    // a green tick earned against the old host says nothing about the new one
    const checked = aDestination().recordCheck({ ok: true, at: '2026-08-10 10:00:00' });

    const moved = checked.withConnection({
      host: RemoteHost.parse('nas2.example.org'),
      port: RemotePort.parse(22),
      account: RemoteAccount.parse('seedbox'),
      path: RemotePath.parse('/volume1/torrents'),
    });

    expect(moved.lastCheck).toBeUndefined();
  });

  it('should_keep_the_verdict_when_only_a_preference_changes', () => {
    // how many files a pass takes on, or where a lone file lands, says nothing
    // about whether the machine answers: re-testing for that would be noise
    const checked = aDestination().recordCheck({ ok: true, at: '2026-08-10 10:00:00' });

    expect(checked.withBatchSize(TransferBatchSize.parse(3)).lastCheck?.ok).toBe(true);
    expect(checked.withPlacement(LoneFilePlacement.inItsOwnFolder).lastCheck?.ok).toBe(true);
  });

  it('should_forget_the_verdict_when_the_password_changes', () => {
    const checked = aDestination().recordCheck({ ok: true, at: '2026-08-10 10:00:00' });

    expect(checked.withPassword('another-sealed-blob').lastCheck).toBeUndefined();
  });

  it('should_remember_why_a_check_failed_so_the_page_can_say_it', () => {
    const failed = aDestination().recordCheck({
      ok: false,
      at: '2026-08-10 10:00:00',
      detail: 'the password was refused',
    });

    expect(failed.lastCheck?.ok).toBe(false);
    expect(failed.lastCheck?.detail).toBe('the password was refused');
  });
});
