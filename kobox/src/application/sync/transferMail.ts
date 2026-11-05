import type { LanguageValue } from '../../domain/portal/Language.js';
import type { SyncTransfer } from '../../domain/sync/SyncTransfer.js';
import { TransferFailure } from '../../domain/sync/TransferFailure.js';
import { failureInWords } from './transferFailureWords.js';

interface ArrivalText {
  readonly subject: (name: string) => string;
  readonly body: (name: string, folder: string) => string;
}

const ARRIVED: Readonly<Record<LanguageValue, ArrivalText>> = {
  en: {
    subject: (name) => `${name} arrived`,
    body: (name, folder) => `${name}, from your ${folder} folder, has arrived on your own machine.\n`,
  },
  fr: {
    subject: (name) => `${name} est arrivé`,
    body: (name, folder) => `${name}, de ton dossier ${folder}, est arrivé sur ta machine.\n`,
  },
};

interface FailureText {
  readonly subject: (name: string) => string;
  readonly opening: (name: string, folder: string) => string;
  // rsync's own words, after the sentence saying what happened
  readonly withRawDetail: (sentence: string, rawDetail: string) => string;
  readonly closing: string;
}

const FAILED: Readonly<Record<LanguageValue, FailureText>> = {
  en: {
    subject: (name) => `${name} did not arrive`,
    opening: (name, folder) =>
      `${name}, from your ${folder} folder, could not be sent to your own machine:`,
    withRawDetail: (sentence, rawDetail) => `${sentence}: ${rawDetail}`,
    closing: 'It stays under Folders on your seedbox, where you can try it again.',
  },
  fr: {
    subject: (name) => `${name} n’est pas arrivé`,
    opening: (name, folder) =>
      `${name}, de ton dossier ${folder}, n’a pas pu être envoyé sur ta machine :`,
    withRawDetail: (sentence, rawDetail) => `${sentence} : ${rawDetail}`,
    closing: 'Il reste dans Dossiers sur ta seedbox, d’où tu peux le réessayer.',
  },
};

function failureMail(
  transfer: SyncTransfer,
  language: LanguageValue,
): { subject: string; body: string } {
  const text = FAILED[language];
  const why = failureInWords(transfer.failure ?? TransferFailure.explained('unexplained'), language);
  const reason =
    why.rawDetail === undefined ? why.sentence : text.withRawDetail(why.sentence, why.rawDetail);
  return {
    subject: text.subject(transfer.name),
    body: [
      text.opening(transfer.name, transfer.label.value),
      `${reason}.`,
      '',
      text.closing,
      '',
    ].join('\n'),
  };
}

/**
 * The mail telling a member what became of one transfer.
 *
 * @param transfer the transfer, once it arrived or failed
 * @param language the language the member reads
 * @returns the subject and body of the mail
 */
export function transferMail(
  transfer: SyncTransfer,
  language: LanguageValue,
): { subject: string; body: string } {
  if (transfer.state !== 'sent') {
    return failureMail(transfer, language);
  }
  const text = ARRIVED[language];
  return {
    subject: text.subject(transfer.name),
    body: text.body(transfer.name, transfer.label.value),
  };
}
