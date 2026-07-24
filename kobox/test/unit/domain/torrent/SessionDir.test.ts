import { describe, expect, it } from 'vitest';
import { SessionDir } from '../../../../src/domain/torrent/SessionDir.js';

describe('SessionDir', () => {
  it('should_derive_the_session_path_from_the_home_directory', () => {
    expect(SessionDir.forHome('/home/alice').value).toBe('/home/alice/rtorrent/.session/');
  });

  it('should_not_double_the_trailing_slash', () => {
    expect(SessionDir.forHome('/home/alice/').value).toBe('/home/alice/rtorrent/.session/');
  });
});
