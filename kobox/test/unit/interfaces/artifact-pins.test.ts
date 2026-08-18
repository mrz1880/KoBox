import { describe, expect, it } from 'vitest';
import { artifactPinsFrom } from '../../../src/interfaces/artifactPins.js';

describe('artifactPinsFrom', () => {
  it('should_carry_every_variable_a_component_needs_to_stop_skipping', () => {
    // the Nextcloud three went missing entirely: the component read settings
    // nothing ever filled, so it could only report "not pinned" for ever, and
    // the only test that reaches it exercises exactly that path
    const pins = artifactPinsFrom({
      KOBOX_RUTORRENT_URL: 'https://example.net/rutorrent.tar.gz',
      KOBOX_RUTORRENT_SHA256: 'a'.repeat(64),
      KOBOX_NANOMON_URL: 'https://example.net/nanomon',
      KOBOX_NANOMON_SHA256: 'b'.repeat(64),
      KOBOX_SPEEDTEST_URL: 'https://example.net/librespeed.tar.gz',
      KOBOX_SPEEDTEST_SHA256: 'c'.repeat(64),
      KOBOX_NEXTCLOUD_URL: 'https://example.net/nextcloud.tar.bz2',
      KOBOX_NEXTCLOUD_SHA256: 'd'.repeat(64),
      KOBOX_NEXTCLOUD_ADMIN_PASSWORD: 'chosen-by-the-operator',
    });

    expect(pins).toEqual({
      rutorrentUrl: 'https://example.net/rutorrent.tar.gz',
      rutorrentSha256: 'a'.repeat(64),
      nanomonUrl: 'https://example.net/nanomon',
      nanomonSha256: 'b'.repeat(64),
      speedtestUrl: 'https://example.net/librespeed.tar.gz',
      speedtestSha256: 'c'.repeat(64),
      nextcloudUrl: 'https://example.net/nextcloud.tar.bz2',
      nextcloudSha256: 'd'.repeat(64),
      nextcloudAdminPassword: 'chosen-by-the-operator',
    });
  });

  it('should_treat_an_empty_export_as_no_pin_at_all', () => {
    // `export KOBOX_NEXTCLOUD_URL=` and never exporting it mean the same thing
    // to an operator, and fetching "" would be a worse answer than skipping
    expect(artifactPinsFrom({ KOBOX_NEXTCLOUD_URL: '' })).toEqual({});
  });

  it('should_leave_a_key_out_rather_than_setting_it_undefined', () => {
    // exactOptionalPropertyTypes: an absent key and a key holding undefined are
    // different things downstream
    expect(Object.keys(artifactPinsFrom({}))).toEqual([]);
  });
});
