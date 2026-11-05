import type { Language, LanguageValue } from '../../domain/portal/Language.js';

/**
 * The language a mail to a member is written in. The members are French
 * speakers: one who never chose a language reads French, in every member mail.
 *
 * @param chosen the member's own choice, absent when they never made one
 * @returns the language to write the mail in
 */
export function mailLanguageOf(chosen: Language | undefined): LanguageValue {
  return chosen?.value ?? 'fr';
}
