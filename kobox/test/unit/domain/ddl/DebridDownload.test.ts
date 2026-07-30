import { describe, expect, it } from 'vitest';
import { DebridDownload } from '../../../../src/domain/ddl/DebridDownload.js';
import { DownloadCategory } from '../../../../src/domain/ddl/DownloadCategory.js';
import { DownloadGid } from '../../../../src/domain/ddl/DownloadGid.js';
import { FilehosterLink } from '../../../../src/domain/ddl/FilehosterLink.js';
import { Username } from '../../../../src/domain/user/Username.js';

const alice = Username.parse('alice');
const link = FilehosterLink.parse('https://1fichier.example/abc');
const gid = DownloadGid.parse('2089b05ecca3d829');

function aRequest(): DebridDownload {
  return DebridDownload.request(
    { username: alice, category: DownloadCategory.films, sourceLink: link },
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
      category: DownloadCategory.series,
      sourceLink: link,
      status: 'downloading',
      gid,
      createdAt: '2026-07-26 12:00:00',
    });
    expect(restored.id).toBe(7);
    expect(restored.status).toBe('downloading');
    expect(aRequest().identifiedBy(9).id).toBe(9);
  });
});
