import { describe, expect, it } from 'vitest';
import { DebridDownload } from '../../../../src/domain/ddl/DebridDownload.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { DownloadGid } from '../../../../src/domain/ddl/DownloadGid.js';
import { FilehosterLink } from '../../../../src/domain/ddl/FilehosterLink.js';
import { Username } from '../../../../src/domain/user/Username.js';

const alice = Username.parse('alice');
const link = FilehosterLink.parse('https://1fichier.example/abc');
const gid = DownloadGid.parse('2089b05ecca3d829');

function aRequest(): DebridDownload {
  return DebridDownload.request(
    { username: alice, category: Label.parse('films'), sourceLink: link },
    '2026-07-26 12:00:00',
  );
}

describe('DebridDownload', () => {
  it('should_start_pending', () => {
    const d = aRequest();
    expect(d.status).toBe('pending');
    expect(d.username.value).toBe('alice');
    expect(d.category.value).toBe('films');
    expect(d.sourceLink.value).toBe('https://1fichier.example/abc');
    expect(d.gid).toBeUndefined();
  });

  it('should_move_to_downloading_with_its_aria2_gid', () => {
    const d = aRequest().startedWith(gid);
    expect(d.status).toBe('downloading');
    expect(d.gid?.value).toBe('2089b05ecca3d829');
  });

  it('should_complete_with_a_filename', () => {
    const d = aRequest().startedWith(gid).completed('Movie.2026.mkv');
    expect(d.status).toBe('done');
    expect(d.filename).toBe('Movie.2026.mkv');
  });

  it('should_fail_with_a_reason', () => {
    const d = aRequest().failed('debrid rejected the host');
    expect(d.status).toBe('failed');
    expect(d.error).toBe('debrid rejected the host');
  });

  it('should_rehydrate_and_take_an_id_without_events', () => {
    const restored = DebridDownload.restore({
      id: 7,
      username: alice,
      category: Label.parse('series'),
      sourceLink: link,
      status: 'downloading',
      gid,
      createdAt: '2026-07-26 12:00:00',
    });
    expect(restored.id).toBe(7);
    expect(restored.status).toBe('downloading');
    expect(aRequest().identifiedBy(9).id).toBe(9);
  });
  it('should_keep_the_same_reading_when_the_percent_has_not_moved', () => {
    const reading = aRequest().startedWith(gid).progressed(40);
    expect(reading.progressed(40)).toBe(reading);
  });

  it('should_record_a_new_reading_and_keep_everything_else', () => {
    const before = aRequest().identifiedBy(3).startedWith(gid).progressed(40);
    const after = before.progressed(55);
    expect(after.percent).toBe(55);
    expect(before.percent).toBe(40);
    expect(after.id).toBe(3);
    expect(after.status).toBe('downloading');
    expect(after.gid?.value).toBe('2089b05ecca3d829');
    expect(after.createdAt).toBe('2026-07-26 12:00:00');
  });

  it('should_carry_its_identity_gid_and_last_reading_through_completion', () => {
    const done = aRequest().identifiedBy(3).startedWith(gid).progressed(99).completed('a.mkv');
    expect(done.id).toBe(3);
    expect(done.gid?.value).toBe('2089b05ecca3d829');
    expect(done.percent).toBe(99);
    expect(done.username.value).toBe('alice');
    expect(done.category.value).toBe('films');
    expect(done.sourceLink.value).toBe('https://1fichier.example/abc');
    expect(done.createdAt).toBe('2026-07-26 12:00:00');
  });

  it('should_keep_the_failure_reason_and_filename_when_given_an_id', () => {
    const failed = aRequest().completed('a.mkv').failed('disk full').identifiedBy(4);
    expect(failed.error).toBe('disk full');
    expect(failed.filename).toBe('a.mkv');
    expect(failed.status).toBe('failed');
  });

  it('should_restore_every_optional_field_it_was_given', () => {
    const restored = DebridDownload.restore({
      username: alice,
      category: Label.parse('series'),
      sourceLink: link,
      status: 'failed',
      filename: 'b.mkv',
      percent: 12,
      error: 'expired',
      createdAt: '2026-07-26 12:00:00',
    });
    expect(restored.id).toBeUndefined();
    expect(restored.filename).toBe('b.mkv');
    expect(restored.percent).toBe(12);
    expect(restored.error).toBe('expired');
  });
});
