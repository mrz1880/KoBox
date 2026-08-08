import { describe, expect, it } from 'vitest';
import { InvalidMediaPathError, MediaPath } from '../../../../src/domain/media/MediaFile.js';

describe('MediaPath', () => {
  it('should_accept_a_relative_path_inside_the_tree', () => {
    const path = MediaPath.parse('films/Some.Release/file.mkv');

    expect(path.value).toBe('films/Some.Release/file.mkv');
    expect(path.name).toBe('file.mkv');
    expect(path.category).toBe('films');
  });

  it('should_refuse_anything_that_could_leave_the_users_tree', () => {
    // the browser sends this value back, so escaping is stopped at the type,
    // not by a check further down that someone might forget
    for (const bad of [
      '../../etc/passwd',
      'films/../../../etc/shadow',
      '/etc/passwd',
      './secret',
      'films/./x',
      'a\0b',
      '',
    ]) {
      expect(() => MediaPath.parse(bad), bad).toThrow(InvalidMediaPathError);
    }
  });

  it('should_report_no_category_for_a_file_at_the_root', () => {
    expect(MediaPath.parse('loose.mkv').category).toBe('');
  });
});
