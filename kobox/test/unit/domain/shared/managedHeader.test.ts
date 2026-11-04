import { describe, expect, it } from 'vitest';
import { MANAGED_MARK, managedHeader } from '../../../../src/domain/shared/managedHeader.js';

// Every file KoBox renders opens with this line, in the comment syntax of its
// format: a reader on the box learns the file is not theirs to edit.
describe('the header of a rendered file', () => {
  it.each([
    ['#', '# KoBox-managed, DO NOT EDIT (rendered declaratively).'],
    ['//', '// KoBox-managed, DO NOT EDIT (rendered declaratively).'],
    [';', '; KoBox-managed, DO NOT EDIT (rendered declaratively).'],
    [';;', ';; KoBox-managed, DO NOT EDIT (rendered declaratively).'],
  ] as const)('should_open_with_the_%s_comment_syntax_of_the_format', (prefix, expected) => {
    expect(managedHeader(prefix)).toBe(expected);
  });

  it('should_name_what_the_file_is_after_the_mark', () => {
    expect(managedHeader('#', 'firewall')).toBe(
      '# KoBox-managed firewall, DO NOT EDIT (rendered declaratively).',
    );
  });

  it('should_carry_the_mark_that_tells_a_kobox_file_apart', () => {
    expect(managedHeader('//', 'file for alice')).toContain(MANAGED_MARK);
  });
});
