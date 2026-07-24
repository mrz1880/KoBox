import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidLabelError, Label } from '../../../../src/domain/torrent/Label.js';

const validLabelArb = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789._-'.split('')),
      maxLength: 63,
    }),
  )
  .map(([first, rest]) => `${first}${rest}`);

describe('Label', () => {
  it('should_accept_path_safe_lowercase_labels', () => {
    fc.assert(
      fc.property(validLabelArb, (raw) => {
        expect(Label.parse(raw).value).toBe(raw);
      }),
    );
  });

  it('should_reject_labels_that_could_escape_a_path_or_a_shell', () => {
    for (const raw of ['', '.hidden', '../up', 'a/b', 'a b', 'a;b', 'a$(id)', 'Ábc', 'A', 'a'.repeat(65)]) {
      expect(() => Label.parse(raw)).toThrow(InvalidLabelError);
    }
  });

  it('should_compare_by_value', () => {
    expect(Label.parse('films').equals(Label.parse('films'))).toBe(true);
    expect(Label.parse('films').equals(Label.parse('series'))).toBe(false);
  });
});
