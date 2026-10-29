import { describe, expect, it } from 'vitest';
import {
  InvalidRecyclingModeError,
  RecyclingMode,
} from '../../../../src/domain/torrent/RecyclingMode.js';

describe('RecyclingMode', () => {
  it('should_say_which_modes_reuse_what_is_already_on_the_box', () => {
    expect(RecyclingMode.none.reusesExistingContent).toBe(false);
    expect(RecyclingMode.copy.reusesExistingContent).toBe(true);
    expect(RecyclingMode.hardlink.reusesExistingContent).toBe(true);
  });

  it('should_single_out_the_mode_that_makes_two_members_share_blocks', () => {
    // this is the one with a consequence for quotas, so the domain names it
    // rather than leaving every caller to remember which string it was
    expect(RecyclingMode.hardlink.sharesInodes).toBe(true);
    expect(RecyclingMode.copy.sharesInodes).toBe(false);
  });

  it('should_refuse_anything_else', () => {
    expect(() => RecyclingMode.parse('symlink')).toThrow(InvalidRecyclingModeError);
  });
  it('should_parse_each_stored_mode_to_its_instance', () => {
    expect(RecyclingMode.parse('none')).toBe(RecyclingMode.none);
    expect(RecyclingMode.parse('copy')).toBe(RecyclingMode.copy);
    expect(RecyclingMode.parse('hardlink')).toBe(RecyclingMode.hardlink);
  });

  it('should_list_the_accepted_modes_when_refusing_one', () => {
    expect(() => RecyclingMode.parse('symlink')).toThrow(
      'invalid recycling mode "symlink": expected none|copy|hardlink',
    );
  });

  it('should_never_share_inodes_when_not_recycling', () => {
    expect(RecyclingMode.none.sharesInodes).toBe(false);
  });

  it('should_compare_by_value', () => {
    expect(RecyclingMode.parse('copy').equals(RecyclingMode.copy)).toBe(true);
    expect(RecyclingMode.copy.equals(RecyclingMode.hardlink)).toBe(false);
  });
});
