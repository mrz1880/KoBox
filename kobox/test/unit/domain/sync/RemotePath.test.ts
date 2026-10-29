import { describe, expect, it } from 'vitest';
import { InvalidRemotePathError, RemotePath } from '../../../../src/domain/sync/RemotePath.js';

describe('RemotePath', () => {
  it('should_keep_the_root_itself_as_a_single_slash', () => {
    expect(RemotePath.parse('/').value).toBe('/');
  });

  it('should_drop_surrounding_whitespace_and_every_trailing_slash', () => {
    expect(RemotePath.parse('  /volume1/torrents// ').value).toBe('/volume1/torrents');
  });

  it('should_accept_dots_underscores_and_dashes_inside_a_segment', () => {
    expect(RemotePath.parse('/vol_1/my-files/v1.2').value).toBe('/vol_1/my-files/v1.2');
  });

  it('should_tell_why_it_refuses_a_relative_path', () => {
    expect(() => RemotePath.parse('volume1')).toThrow(
      'invalid remote path "volume1": it must start at the root of the other machine',
    );
  });

  it('should_refuse_a_forbidden_character_anywhere_in_the_path', () => {
    // anchored at both ends: a valid start or a valid end does not excuse the rest
    for (const raw of ['/a b/c', '/a/b c', '/a;b']) {
      expect(() => RemotePath.parse(raw), raw).toThrow(
        /letters, digits, dot, underscore, dash and slash only/,
      );
    }
  });

  it('should_tell_why_it_refuses_a_path_that_climbs', () => {
    expect(() => RemotePath.parse('/volume1/..')).toThrow(/it climbs out of itself/);
  });

  it('should_accept_a_segment_that_only_contains_two_dots', () => {
    expect(RemotePath.parse('/v..1').value).toBe('/v..1');
  });

  it('should_compare_by_value_and_print_as_itself', () => {
    const path = RemotePath.parse('/volume1');

    expect(path.equals(RemotePath.parse('/volume1/'))).toBe(true);
    expect(path.equals(RemotePath.parse('/volume2'))).toBe(false);
    expect(String(path)).toBe('/volume1');
  });

  it('should_report_errors_as_invalid_remote_paths', () => {
    expect(() => RemotePath.parse('')).toThrow(InvalidRemotePathError);
  });
});
