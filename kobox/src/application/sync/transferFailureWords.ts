import type { LanguageValue } from '../../domain/portal/Language.js';
import {
  TRANSFER_FAILURE_REASONS,
  type ExplainedFailure,
  type TransferFailure,
} from '../../domain/sync/TransferFailure.js';

// Why a transfer did not arrive, as a member reads it: on the page and in the
// mail alike, so both say the same thing. The words are impersonal on purpose:
// the page speaks to a member as "vous", the mails as "tu".
interface FailureWords {
  readonly explained: Readonly<Record<ExplainedFailure, string>>;
  readonly stopped: (exitCode: string) => string;
  // said before rsync's own words, which have no translation
  readonly reported: string;
}

const WORDS: Readonly<Record<LanguageValue, FailureWords>> = {
  en: {
    // the English is the recorded sentence itself
    explained: TRANSFER_FAILURE_REASONS,
    stopped: (exitCode) => `rsync stopped with code ${exitCode}`,
    reported: 'rsync stopped on an error KoBox cannot explain',
  },
  fr: {
    explained: {
      refused: 'la machine a refusé le compte, le mot de passe ou ce dossier',
      'identity-changed':
        'la machine s’est présentée avec une autre identité que celle enregistrée pour elle, donc rien n’a été envoyé : si elle a été réinstallée, il faut tester à nouveau la connexion pour accepter sa nouvelle identité, sinon mieux vaut s’arrêter et chercher pourquoi',
      'no-room': 'l’autre machine n’a plus de place',
      dropped: 'la connexion a coupé en cours de route : elle reprendra là où elle s’est arrêtée',
      'no-answer': 'la machine n’a pas répondu',
      'source-gone': 'le fichier n’est plus sur la box',
      unexplained: 'il n’est pas passé',
    },
    stopped: (exitCode) => `rsync s’est arrêté avec le code ${exitCode}`,
    reported: 'rsync s’est arrêté sur une erreur que KoBox ne sait pas expliquer',
  },
};

/** A failure in a member's words. */
export interface FailureInWords {
  // what happened, in the member's language
  readonly sentence: string;
  // rsync's own words, as they came, when that is all that is known
  readonly rawDetail?: string;
}

/**
 * Says why a transfer did not arrive, in the member's language.
 *
 * @param failure why it did not arrive
 * @param language the language the member reads
 * @returns the sentence, and rsync's own words when it said something KoBox
 * does not recognise
 */
export function failureInWords(failure: TransferFailure, language: LanguageValue): FailureInWords {
  const words = WORDS[language];
  const cause = failure.cause;
  switch (cause.kind) {
    case 'explained':
      return { sentence: words.explained[cause.reason] };
    case 'stopped':
      return { sentence: words.stopped(String(cause.exitCode)) };
    case 'reported':
      return { sentence: words.reported, rawDetail: cause.line };
  }
}
