import { describe, expect, it } from 'vitest';
import { passwordLinkMail } from '../../../../src/application/portal/passwordLinkMail.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import type { PasswordLinkPurpose } from '../../../../src/domain/portal/PasswordLink.js';

const URL = 'https://box.example.org/password-link/abc123';

function mailFor(purpose: PasswordLinkPurpose, language: Language | undefined) {
  return passwordLinkMail({
    recipient: 'alice@example.org',
    username: 'alice',
    purpose,
    language,
    url: URL,
  });
}

// The mail is what the member reads: its exact text is the behaviour.
describe('passwordLinkMail', () => {
  it('should_welcome_a_member_who_never_chose_a_language_in_french', () => {
    const mail = mailFor('invitation', undefined);

    expect(mail.recipient).toBe('alice@example.org');
    expect(mail.subject).toBe('Bienvenue sur la seedbox');
    expect(mail.body).toBe(
      [
        'Bonjour alice,',
        '',
        'Ton compte sur la seedbox est prêt. Choisis ton mot de passe ici :',
        '',
        URL,
        '',
        'Ce lien sert une seule fois et reste valable 7 jours.',
        '',
        'Ce même mot de passe ouvre le portail, Nextcloud et le partage réseau.',
        '',
        'Une fois connecté, commence par créer tes dossiers (Films, Series...) dans',
        "la page Dossiers du portail : c'est là que tes téléchargements seront rangés.",
      ].join('\n'),
    );
  });

  it('should_send_a_french_reset_valid_for_one_hour', () => {
    const mail = mailFor('reset', Language.fr);

    expect(mail.subject).toBe('Choisir un nouveau mot de passe');
    expect(mail.body).toBe(
      [
        'Bonjour alice,',
        '',
        'Pour choisir un nouveau mot de passe, ouvre ce lien :',
        '',
        URL,
        '',
        "Il sert une seule fois et reste valable 1 heure. Si tu n'as rien demandé,",
        'ignore ce message : ton mot de passe actuel ne change pas.',
      ].join('\n'),
    );
  });

  it('should_welcome_a_member_who_chose_english_in_english', () => {
    const mail = mailFor('invitation', Language.en);

    expect(mail.subject).toBe('Welcome to the seedbox');
    expect(mail.body).toBe(
      [
        'Hello alice,',
        '',
        'Your seedbox account is ready. Choose your password here:',
        '',
        URL,
        '',
        'This link works once and for 7 days.',
        '',
        'The same password opens the portal, Nextcloud and the network share.',
        '',
        'Once in, start by creating your folders (Films, Series...) on the',
        "portal's Folders page: that is where your downloads are sorted.",
      ].join('\n'),
    );
  });

  it('should_send_an_english_reset_valid_for_one_hour', () => {
    const mail = mailFor('reset', Language.en);

    expect(mail.subject).toBe('Choose a new password');
    expect(mail.body).toBe(
      [
        'Hello alice,',
        '',
        'To choose a new password, open this link:',
        '',
        URL,
        '',
        'It works once and for 1 hour. If you did not ask for it, ignore this',
        'message: your current password stays as it is.',
      ].join('\n'),
    );
  });
});
