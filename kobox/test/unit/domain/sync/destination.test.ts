import { describe, expect, it } from 'vitest';
import { InvalidRemoteHostError, RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import {
  InvalidRemoteAccountError,
  RemoteAccount,
} from '../../../../src/domain/sync/RemoteAccount.js';
import { InvalidRemotePathError, RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePassword } from '../../../../src/domain/sync/RemotePassword.js';
import {
  InvalidBatchSizeError,
  TransferBatchSize,
} from '../../../../src/domain/sync/TransferBatchSize.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';

describe('RemoteHost', () => {
  it('should_accept_a_hostname_or_an_address', () => {
    for (const raw of ['nas.example.org', 'nas', '192.0.2.10', 'a-b.example.org']) {
      expect(RemoteHost.parse(raw).value, raw).toBe(raw);
    }
  });

  it('should_refuse_anything_that_would_not_survive_being_an_argv_value', () => {
    // it ends up as the host half of user@host on an ssh command line
    for (const raw of [
      '',
      'nas example',
      'nas;reboot',
      '-oProxyCommand=x',
      'nas/../x',
      'a'.repeat(254),
    ]) {
      expect(() => RemoteHost.parse(raw), raw).toThrow(InvalidRemoteHostError);
    }
  });
});

describe('RemoteAccount', () => {
  it('should_accept_an_account_name_on_the_other_machine', () => {
    // a NAS account is not one of ours: its charset is the remote system's
    for (const raw of ['alice', 'nas-backup', 'user_1', 'Alice']) {
      expect(RemoteAccount.parse(raw).value, raw).toBe(raw);
    }
  });

  it('should_refuse_a_name_that_could_become_an_ssh_option', () => {
    for (const raw of ['', '-oProxyCommand=x', 'a b', 'a@b', 'a'.repeat(65)]) {
      expect(() => RemoteAccount.parse(raw), raw).toThrow(InvalidRemoteAccountError);
    }
  });
});

describe('RemotePath', () => {
  it('should_accept_an_absolute_directory_on_the_other_machine', () => {
    expect(RemotePath.parse('/volume1/torrents').value).toBe('/volume1/torrents');
  });

  it('should_drop_a_trailing_slash_so_one_join_never_doubles_it', () => {
    expect(RemotePath.parse('/volume1/torrents/').value).toBe('/volume1/torrents');
  });

  it('should_refuse_a_relative_path_or_one_that_climbs', () => {
    for (const raw of ['', 'volume1', '/volume1/../etc', '/vol ume', '/a b']) {
      expect(() => RemotePath.parse(raw), raw).toThrow(InvalidRemotePathError);
    }
  });

  it('should_place_a_category_under_itself', () => {
    expect(RemotePath.parse('/volume1/torrents').join('films')).toBe('/volume1/torrents/films');
  });
});

describe('RemotePassword', () => {
  it('should_never_reveal_itself_through_a_log_line_or_a_template', () => {
    const password = RemotePassword.parse('correct horse battery');

    expect(password.reveal()).toBe('correct horse battery');
    expect(String(password)).toBe('[redacted]');
    expect(JSON.stringify({ password })).not.toContain('horse');
  });
});

describe('TransferBatchSize', () => {
  it('should_read_zero_as_everything_waiting', () => {
    // the legacy encoded "no limit" as 0 and the screen said "0 (Tout)"
    expect(TransferBatchSize.parse(0).isUnlimited).toBe(true);
    expect(TransferBatchSize.parse(5).isUnlimited).toBe(false);
  });

  it('should_refuse_a_negative_or_fractional_count', () => {
    for (const raw of [-1, 1.5, Number.NaN]) {
      expect(() => TransferBatchSize.parse(raw), String(raw)).toThrow(InvalidBatchSizeError);
    }
  });
});

describe('LoneFilePlacement', () => {
  it('should_name_the_two_ways_a_single_file_can_land', () => {
    // the legacy called this create_subdir=1|0; a scraper that expects one
    // folder per film needs the folder, and a boolean never said which
    expect(LoneFilePlacement.parse('beside-the-others').value).toBe('beside-the-others');
    expect(LoneFilePlacement.parse('in-its-own-folder').value).toBe('in-its-own-folder');
  });
});
