import { describe, expect, it } from 'vitest';
import { InvalidLocalPathError, LocalPath } from '../../../../src/domain/sync/LocalPath.js';

describe('LocalPath', () => {
  it('should_accept_a_release_name_with_spaces_and_brackets', () => {
    const raw = "/home/alice/complete/Some Film [1080p] (l'original).mkv";

    expect(LocalPath.parse(raw).value).toBe(raw);
  });

  it('should_tell_why_it_refuses_a_relative_path', () => {
    expect(() => LocalPath.parse('home/alice')).toThrow(
      'invalid local path "home/alice": it is not absolute',
    );
  });

  it('should_tell_why_it_refuses_a_nul', () => {
    expect(() => LocalPath.parse('/home/alice\0x')).toThrow(/it contains a NUL/);
  });

  it('should_tell_why_it_refuses_a_path_that_climbs', () => {
    expect(() => LocalPath.parse('/home/alice/../bob')).toThrow(/it climbs out of itself/);
  });

  it('should_accept_a_name_that_only_contains_two_dots', () => {
    expect(LocalPath.parse('/home/alice/Film..mkv').value).toBe('/home/alice/Film..mkv');
  });

  it('should_accept_4096_characters_and_refuse_4097', () => {
    const longest = `/${'a'.repeat(4095)}`;

    expect(LocalPath.parse(longest).value).toBe(longest);
    expect(() => LocalPath.parse(`${longest}a`)).toThrow(/longer than a path can be/);
  });

  it('should_drop_every_trailing_slash', () => {
    expect(LocalPath.parse('/home/alice/films//').value).toBe('/home/alice/films');
  });

  it('should_keep_the_root_when_it_is_only_slashes', () => {
    expect(LocalPath.parse('///').value).toBe('/');
  });

  it('should_name_itself_after_its_last_segment', () => {
    expect(LocalPath.parse('/home/alice/films/Some.Film.mkv').name).toBe('Some.Film.mkv');
  });

  it('should_be_inside_its_own_directory_and_the_directory_itself', () => {
    const path = LocalPath.parse('/home/alice/films');

    expect(path.isInside('/home/alice')).toBe(true);
    expect(path.isInside('/home/alice/')).toBe(true);
    expect(path.isInside('/home/alice//')).toBe(true);
    expect(path.isInside('/home/alice/films')).toBe(true);
  });

  it('should_not_be_inside_a_sibling_that_shares_its_prefix', () => {
    expect(LocalPath.parse('/home/alice2/films').isInside('/home/alice')).toBe(false);
  });

  it('should_compare_by_value_and_print_as_itself', () => {
    const path = LocalPath.parse('/home/alice');

    expect(path.equals(LocalPath.parse('/home/alice/'))).toBe(true);
    expect(path.equals(LocalPath.parse('/home/bob'))).toBe(false);
    expect(String(path)).toBe('/home/alice');
  });

  it('should_report_errors_as_invalid_local_paths', () => {
    expect(() => LocalPath.parse('')).toThrow(InvalidLocalPathError);
  });
});
