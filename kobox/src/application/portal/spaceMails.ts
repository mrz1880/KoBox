import type { OutboxMailDraft } from '../maintenance/MailOutboxPort.js';
import type { Language, LanguageValue } from '../../domain/portal/Language.js';
import type { CleanupReport } from '../../domain/space/CleanupReport.js';
import type { Quota } from '../../domain/user/Quota.js';
import { mailLanguageOf } from './mailLanguage.js';

type MailLanguage = LanguageValue;

const GIB_UNIT: Record<MailLanguage, string> = { fr: 'Gio', en: 'GiB' };
const WHOLE_PERCENT = 100;

// A size in GiB to one decimal, with the reader's decimal mark: a mail is
// plain text read once, so one unit throughout reads better than the portal's
// MiB, GiB or TiB.
function inGib(size: Quota, language: MailLanguage): string {
  const amount = size.toGib().toLocaleString(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  });
  return `${amount} ${GIB_UNIT[language]}`;
}

// The whole percent of the allowance in use; with no allowance at all, the
// member is as full as can be.
function percentOf(used: Quota, allowance: Quota): number {
  if (allowance.toBytes() === 0) {
    return WHOLE_PERCENT;
  }
  return Math.floor((used.toBytes() / allowance.toBytes()) * WHOLE_PERCENT);
}

export interface RunningOutFacts {
  readonly username: string;
  readonly used: Quota;
  readonly allowance: Quota;
  readonly freeable: Quota;
  readonly url: string;
}

interface MailText {
  readonly subject: string;
  readonly lines: (facts: RunningOutFacts, language: MailLanguage) => readonly string[];
}

const RUNNING_OUT: Record<MailLanguage, MailText> = {
  fr: {
    subject: 'Ta seedbox est presque pleine',
    lines: (facts, language) => [
      `Bonjour ${facts.username},`,
      '',
      `Tu utilises ${String(percentOf(facts.used, facts.allowance))} % de ton espace (${inGib(facts.used, language)} sur ${inGib(facts.allowance, language)}).`,
      "Une fois plein, rTorrent ne peut plus écrire et tes téléchargements s'arrêtent.",
      '',
      ...(facts.freeable.toBytes() === 0
        ? [
            'Rien ne peut être nettoyé pour le moment : tes torrents partagent encore.',
            "Supprime des fichiers à la main, ou demande plus d'espace à un administrateur.",
            '',
            'Ce que KoBox pourra supprimer apparaîtra ici :',
          ]
        : [
            `Tu peux libérer ${inGib(facts.freeable, language)} en supprimant des torrents déjà envoyés chez toi ou qui ont assez partagé. Choisis-les ici :`,
          ]),
      '',
      facts.url,
    ],
  },
  en: {
    subject: 'Your seedbox is almost full',
    lines: (facts, language) => [
      `Hello ${facts.username},`,
      '',
      `You are using ${String(percentOf(facts.used, facts.allowance))} % of your space (${inGib(facts.used, language)} of ${inGib(facts.allowance, language)}).`,
      'Once it is full, rTorrent can no longer write and your downloads stop.',
      '',
      ...(facts.freeable.toBytes() === 0
        ? [
            'Nothing can be cleaned for now: your torrents are still seeding.',
            'Delete files by hand, or ask an administrator for more space.',
            '',
            'What KoBox can delete will show here:',
          ]
        : [
            `You can free ${inGib(facts.freeable, language)} by deleting torrents already sent to your machine or that seeded enough. Pick them here:`,
          ]),
      '',
      facts.url,
    ],
  },
};

// Told once per climb past the critical line: how full the member is, what
// they could free and where.
export function spaceRunningOutMail(input: {
  readonly recipient: string;
  readonly language: Language | undefined;
  readonly facts: RunningOutFacts;
}): OutboxMailDraft {
  const language = mailLanguageOf(input.language);
  const text = RUNNING_OUT[language];
  return {
    recipient: input.recipient,
    subject: text.subject,
    body: text.lines(input.facts, language).join('\n'),
  };
}

interface CleanupMailText {
  readonly subject: string;
  readonly lines: (
    input: { readonly username: string; readonly report: CleanupReport; readonly url: string },
    language: MailLanguage,
  ) => readonly string[];
}

const AUTOMATIC_CLEANUP: Record<MailLanguage, CleanupMailText> = {
  fr: {
    subject: 'KoBox a fait de la place sur ta seedbox',
    lines: ({ username, report, url }, language) => [
      `Bonjour ${username},`,
      '',
      'Ta seedbox avait dépassé 90 % de ton espace.',
      ...(report.deleted.length === 0
        ? [
            "Comme tu l'as choisi, KoBox devait faire de la place, mais n'a finalement rien supprimé :",
            'ce qui était prévu ne remplissait plus les conditions.',
          ]
        : [
            "Comme tu l'as choisi, KoBox a supprimé pour de bon :",
            '',
            ...report.deleted.map((line) => `- ${line.name} (${inGib(line.size, language)})`),
            '',
            `Espace libéré : ${inGib(report.freed, language)}.`,
          ]),
      '',
      'Le détail, et ce que tu peux encore supprimer toi-même, sont ici :',
      '',
      url,
      '',
      'Tu peux changer ce choix dans Mon compte.',
    ],
  },
  en: {
    subject: 'KoBox made room on your seedbox',
    lines: ({ username, report, url }, language) => [
      `Hello ${username},`,
      '',
      'Your seedbox went past 90 % of your space.',
      ...(report.deleted.length === 0
        ? [
            'As you chose, KoBox was to make room, but deleted nothing in the end:',
            'what it planned to delete no longer qualified.',
          ]
        : [
            'As you chose, KoBox deleted for good:',
            '',
            ...report.deleted.map((line) => `- ${line.name} (${inGib(line.size, language)})`),
            '',
            `Space given back: ${inGib(report.freed, language)}.`,
          ]),
      '',
      'The details, and what you can still delete yourself, are here:',
      '',
      url,
      '',
      'You can change this choice in My account.',
    ],
  },
};

// After a cleanup KoBox ran on its own: the member did not click anything, so
// they are told what went for good and what it gave back.
export function automaticCleanupMail(input: {
  readonly recipient: string;
  readonly language: Language | undefined;
  readonly username: string;
  readonly report: CleanupReport;
  readonly url: string;
}): OutboxMailDraft {
  const language = mailLanguageOf(input.language);
  const text = AUTOMATIC_CLEANUP[language];
  return {
    recipient: input.recipient,
    subject: text.subject,
    body: text.lines(input, language).join('\n'),
  };
}
