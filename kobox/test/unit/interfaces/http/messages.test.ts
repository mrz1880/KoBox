import { describe, expect, it } from 'vitest';
import { Language } from '../../../../src/domain/portal/Language.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';

describe('translatorFor', () => {
  it('should_give_a_french_member_french', () => {
    expect(translatorFor(Language.fr)('Downloads')).toBe('Téléchargements');
  });

  it('should_give_english_back_unchanged', () => {
    expect(translatorFor(Language.en)('Downloads')).toBe('Downloads');
  });

  it('should_fall_back_to_the_english_rather_than_showing_a_key', () => {
    // an untranslated line costs that line. A missing-key marker on screen
    // would cost the page, and is what makes half-translated apps look broken.
    expect(translatorFor(Language.fr)('Something nobody has translated yet')).toBe(
      'Something nobody has translated yet',
    );
  });

  it('should_let_a_translation_put_the_value_where_its_own_grammar_needs_it', () => {
    // French does not always keep English word order, so substitution happens
    // after lookup rather than by concatenating around a fixed hole
    expect(translatorFor(Language.fr)('{name} may now add torrents from public trackers.', { name: 'alice' }))
      .toBe('alice peut désormais ajouter des torrents depuis des trackers publics.');
  });
});
