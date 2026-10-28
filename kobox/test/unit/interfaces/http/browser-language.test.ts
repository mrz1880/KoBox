import { describe, expect, it } from 'vitest';
import { Language } from '../../../../src/domain/portal/Language.js';
import { browserLanguage } from '../../../../src/interfaces/http/browserLanguage.js';

describe('browserLanguage', () => {
  it.each([
    ['fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7', Language.fr],
    ['en-US,en;q=0.9,fr;q=0.8', Language.en],
    ['de-DE,de;q=0.9,fr;q=0.5', Language.fr], // first one we speak, by weight
    ['en;q=0.4,fr;q=0.8', Language.fr], // weight beats order
    ['FR', Language.fr],
  ])('should_pick_the_language_the_browser_prefers_among_ours_for_%s', (header, expected) => {
    expect(browserLanguage(header)).toBe(expected);
  });

  it.each([[undefined], [''], ['de-DE,es;q=0.8'], ['*'], ['fr;q=0']])(
    'should_fall_back_to_english_when_the_browser_names_none_of_ours_%s',
    (header) => {
      expect(browserLanguage(header)).toBe(Language.en);
    },
  );
});
