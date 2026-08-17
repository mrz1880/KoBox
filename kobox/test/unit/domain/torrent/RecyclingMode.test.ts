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
});
