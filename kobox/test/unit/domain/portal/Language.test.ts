import { describe, expect, it } from 'vitest';
import { InvalidLanguageError, Language } from '../../../../src/domain/portal/Language.js';

describe('Language', () => {
  it('should_carry_the_two_languages_the_portal_speaks', () => {
    expect(Language.parse('fr').equals(Language.fr)).toBe(true);
    expect(Language.parse('en').equals(Language.en)).toBe(true);
  });

  it('should_refuse_anything_the_portal_has_no_words_for', () => {
    // a language nobody wrote strings for would render an English page with a
    // French page's promise, which is worse than not offering it
    expect(() => Language.parse('de')).toThrow(InvalidLanguageError);
    expect(() => Language.parse('fr-BE')).toThrow(InvalidLanguageError);
  });
});
