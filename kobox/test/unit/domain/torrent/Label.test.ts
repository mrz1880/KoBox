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

  it('should_accept_the_capitalised_categories_a_real_mysb_box_carries', () => {
    // Read off a live MySB seedbox: MySB stripped accents and spaces but kept
    // the case, and the label becomes a folder name on the member's own NAS.
    // Lower-casing them on import would silently create a SECOND set of folders
    // there, next to the ones already full of their files.
    for (const raw of ['Films', 'Series', 'Divers', 'Jeux', 'Apps', 'Autres', 'Audiobook']) {
      expect(Label.parse(raw).value, raw).toBe(raw);
    }
  });

  it('should_reject_labels_that_could_escape_a_path_or_a_shell', () => {
    // 'A' used to be in this list, back when labels were lower case only. A
    // live MySB box carries Films and Series, so that expectation was wrong
    // about the world, not strict about safety. Accents still go: 'Ábc' stays.
    for (const raw of ['', '.hidden', '../up', 'a/b', 'a b', 'a;b', 'a$(id)', 'Ábc', 'a'.repeat(65)]) {
      expect(() => Label.parse(raw)).toThrow(InvalidLabelError);
    }
  });

  it('should_compare_by_value', () => {
    expect(Label.parse('films').equals(Label.parse('films'))).toBe(true);
    expect(Label.parse('films').equals(Label.parse('series'))).toBe(false);
  });
});
