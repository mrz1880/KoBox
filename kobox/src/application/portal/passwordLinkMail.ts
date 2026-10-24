import type { OutboxMailDraft } from '../maintenance/MailOutboxPort.js';
import type { Language } from '../../domain/portal/Language.js';
import type { PasswordLinkPurpose } from '../../domain/portal/PasswordLink.js';

interface MailText {
  readonly subject: string;
  readonly lines: (username: string, url: string) => readonly string[];
}

const TEXTS: Record<'fr' | 'en', Record<PasswordLinkPurpose, MailText>> = {
  fr: {
    invitation: {
      subject: 'Bienvenue sur la seedbox',
      lines: (username, url) => [
        `Bonjour ${username},`,
        '',
        'Ton compte sur la seedbox est prêt. Choisis ton mot de passe ici :',
        '',
        url,
        '',
        'Ce lien sert une seule fois et reste valable 7 jours.',
        '',
        'Ce même mot de passe ouvre le portail, Nextcloud et le partage réseau.',
      ],
    },
    reset: {
      subject: 'Choisir un nouveau mot de passe',
      lines: (username, url) => [
        `Bonjour ${username},`,
        '',
        'Pour choisir un nouveau mot de passe, ouvre ce lien :',
        '',
        url,
        '',
        "Il sert une seule fois et reste valable 1 heure. Si tu n'as rien demandé,",
        'ignore ce message : ton mot de passe actuel ne change pas.',
      ],
    },
  },
  en: {
    invitation: {
      subject: 'Welcome to the seedbox',
      lines: (username, url) => [
        `Hello ${username},`,
        '',
        'Your seedbox account is ready. Choose your password here:',
        '',
        url,
        '',
        'This link works once and for 7 days.',
        '',
        'The same password opens the portal, Nextcloud and the network share.',
      ],
    },
    reset: {
      subject: 'Choose a new password',
      lines: (username, url) => [
        `Hello ${username},`,
        '',
        'To choose a new password, open this link:',
        '',
        url,
        '',
        "It works once and for 1 hour. If you did not ask for it, ignore this",
        'message: your current password stays as it is.',
      ],
    },
  },
};

// The members are French speakers: a member who never chose a language reads
// French. The mail carries the link and how long it lasts, never a password.
export function passwordLinkMail(input: {
  readonly recipient: string;
  readonly username: string;
  readonly purpose: PasswordLinkPurpose;
  readonly language: Language | undefined;
  readonly url: string;
}): OutboxMailDraft {
  const text = TEXTS[input.language?.value ?? 'fr'][input.purpose];
  return {
    recipient: input.recipient,
    subject: text.subject,
    body: text.lines(input.username, input.url).join('\n'),
  };
}
