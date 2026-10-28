import { DomainError } from '../shared/DomainError.js';

export const LANGUAGES = ['en', 'fr'] as const;
export type LanguageValue = (typeof LANGUAGES)[number];

export class InvalidLanguageError extends DomainError {
  constructor(raw: string) {
    super(`invalid language ${JSON.stringify(raw)}: expected ${LANGUAGES.join('|')}`);
  }
}

// A language the portal speaks. A member's stored choice always wins: a
// browser guess changes when someone opens the page from a borrowed machine,
// and a seedbox shared between two households needs each member's choice to
// stay put. The browser's Accept-Language only fills in for a member who never
// chose.
export class Language {
  private constructor(readonly value: LanguageValue) {}

  static readonly en = new Language('en');
  static readonly fr = new Language('fr');

  static parse(raw: string): Language {
    switch (raw) {
      case 'en':
        return Language.en;
      case 'fr':
        return Language.fr;
      default:
        throw new InvalidLanguageError(raw);
    }
  }

  equals(other: Language): boolean {
    return this.value === other.value;
  }
}
