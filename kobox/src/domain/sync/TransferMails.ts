import { DomainError } from '../shared/DomainError.js';
import type { TransferState } from './SyncTransfer.js';

export class InvalidTransferMailsError extends DomainError {
  constructor(raw: string) {
    super(`invalid transfer mail choice ${JSON.stringify(raw)}`);
  }
}

// When a member hears by mail about what the send pass did. Nothing by
// default: most members watch the list, and a mail per file is noise to them.
export const TRANSFER_MAILS = ['never', 'failures', 'every'] as const;
export type TransferMails = (typeof TRANSFER_MAILS)[number];
export const DEFAULT_TRANSFER_MAILS: TransferMails = 'never';

const MAILED_STATES: Readonly<Record<TransferMails, readonly TransferState[]>> = {
  never: [],
  failures: ['failed'],
  every: ['sent', 'failed'],
};

export function parseTransferMails(raw: string): TransferMails {
  const match = TRANSFER_MAILS.find((choice) => choice === raw);
  if (match === undefined) {
    throw new InvalidTransferMailsError(raw);
  }
  return match;
}

export function mailsAbout(choice: TransferMails, state: TransferState): boolean {
  return MAILED_STATES[choice].includes(state);
}
