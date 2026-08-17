import type { Language } from '../../../domain/portal/Language.js';

// The English string is the key. Two reasons: nothing has to invent an
// identifier, and a missing translation renders the English rather than a
// `page.title.missing` staring back at somebody. Adding a language means adding
// a column here; forgetting a line costs that line, never the page.
const FR: Readonly<Record<string, string>> = {
  // navigation
  Home: 'Accueil',
  'My media': 'Mes fichiers',
  Downloads: 'Téléchargements',
  Sending: 'Envoi',
  Folders: 'Dossiers',
  Account: 'Mon compte',
  'Sign out': 'Se déconnecter',
  Overview: 'Vue d’ensemble',

  // my media
  'Nothing here yet. Files appear once a download finishes.':
    'Rien pour l’instant. Les fichiers apparaissent quand un téléchargement se termine.',
  'Empty for now.': 'Vide pour le moment.',
  File: 'Fichier',
  Size: 'Taille',
  Watch: 'Regarder',
  Download: 'Télécharger',
  'Loose files': 'Fichiers isolés',

  // downloads
  'Filehoster link': 'Lien d’hébergeur',
  Folder: 'Dossier',
  'Start download': 'Lancer le téléchargement',
  Status: 'État',
  Detail: 'Détail',
  Requested: 'Demandé',
  'Nothing here yet. Submit a link above to start.':
    'Rien pour l’instant. Collez un lien ci-dessus pour commencer.',

  // account
  'My access': 'Mon accès',
  'Your details': 'Vos informations',
  Username: 'Identifiant',
  Files: 'Fichiers',
  'Change password': 'Changer de mot de passe',
  'Your own SSH key': 'Votre clé SSH',
  'Public key': 'Clé publique',
  'Install this key': 'Installer cette clé',
  'Remove it': 'La retirer',
  Language: 'Langue',
  'Save language': 'Enregistrer la langue',
  English: 'Anglais',
  'French (Français)': 'Français',

  // admin navigation
  Users: 'Membres',
  Trackers: 'Trackers',
  Blocklists: 'Listes de blocage',
  Addresses: 'Adresses',
  'Fair use': 'Usage raisonnable',
  Health: 'État du système',
  Logs: 'Journaux',
  Updates: 'Mises à jour',
  Config: 'Configuration',
  Mails: 'Courriels',
  'Mail relay': 'Relais mail',
  Domain: 'Nom de domaine',
  Monitoring: 'Supervision',

  // members
  Email: 'Adresse mail',
  Type: 'Type',
  Quota: 'Quota',
  SCGI: 'SCGI',
  'Create user': 'Créer un membre',
  'Initial password': 'Mot de passe initial',
  'Quota (GiB)': 'Quota (Gio)',
  'Account type': 'Type de compte',
  'Portal role': 'Rôle sur le portail',
  Suspend: 'Suspendre',
  Resume: 'Réactiver',
  'Delete (irreversible)': 'Supprimer (irréversible)',
  'Reset password': 'Réinitialiser le mot de passe',
  'New password': 'Nouveau mot de passe',
  Storage: 'Stockage',
  'Allowance (GiB)': 'Allocation (Gio)',
  Save: 'Enregistrer',
  'Public trackers': 'Trackers publics',
  'Their own scripts': 'Leurs propres scripts',
  Nextcloud: 'Nextcloud',
  'Reusing what is already here': 'Réutiliser ce qui est déjà là',
  'What to do': 'Que faire',
  'Download it again (default)': 'Le retélécharger (par défaut)',
  'Copy the files, so they get their own': 'Copier les fichiers, chacun a les siens',
  'Share the same files on disk': 'Partager les mêmes fichiers sur le disque',
  'Create their Nextcloud account': 'Créer son compte Nextcloud',
  active: 'actif',
  suspended: 'suspendu',
  'Nothing measured yet. The hourly pass writes this down.':
    'Rien de mesuré pour l’instant. La passe horaire l’inscrira.',
  'No rTorrent instance yet, so there is nothing to allow.':
    'Pas encore d’instance rTorrent, il n’y a donc rien à autoriser.',
  'No rTorrent instance yet, so nothing runs.':
    'Pas encore d’instance rTorrent, rien ne s’exécute.',
  'No rTorrent instance yet.': 'Pas encore d’instance rTorrent.',

  // flash messages, member page
  '{name} may now add torrents from public trackers.':
    '{name} peut désormais ajouter des torrents depuis des trackers publics.',
  '{name} is back to private trackers only.':
    '{name} revient aux trackers privés uniquement.',

  // trackers and blocklists
  Source: 'Source',
  Author: 'Auteur',
  Name: 'Nom',
  Enabled: 'Activée',
  'Last update': 'Dernière mise à jour',
  'in the filter': 'dans le filtre',
  'Update now': 'Mettre à jour maintenant',
  'Import the catalog': 'Importer le catalogue',
  Host: 'Hôte',
  Privacy: 'Confidentialité',
  'Certificate expiry': 'Expiration du certificat',
  'Renew certificates': 'Renouveler les certificats',

  // mail relay and domain
  Mail: 'Courriel',
  'Relay host': 'Hôte du relais',
  Port: 'Port',
  Login: 'Identifiant',
  Password: 'Mot de passe',
  'Save and apply': 'Enregistrer et appliquer',
  'Does it work?': 'Est-ce que ça marche ?',
  'Send me a test message': 'M’envoyer un message de test',
  'Domain and certificate': 'Nom de domaine et certificat',
  'Public name': 'Nom public',
  'Where certificate notices go': 'Où arrivent les avis de certificat',

  // admin prose, keyed rather than quoted: a six-line paragraph makes a poor
  // lookup key, and reflowing the English would silently orphan its translation
  'members.intro':
    'Toutes les personnes ayant un compte sur la machine. En créer un provisionne un vrai compte système, sa propre instance rTorrent sur son propre port, un répertoire personnel avec un quota et un profil VPN, puis lui envoie un mot de passe temporaire qu’il devra changer à la première connexion. Le port SCGI est celui auquel parle son ruTorrent ; il est affiché parce que c’est ce dont vous avez besoin quand quelque chose cloche, et il est conservé en cas de migration.',
  'members.suspend':
    'Suspendre est réversible et coupe l’accès sans toucher au moindre fichier : les transferts s’arrêtent, les données restent. Supprimer ne l’est pas.',
  'trackers.public.why':
    'Les trackers publics sont surveillés par les sociétés anti-piratage, et c’est pourquoi cette autorisation reste fermée sauf demande. Les torrents déjà ajoutés ne sont pas touchés.',
  'trackers.public.checkbox':
    'Autoriser {name} à ajouter des torrents depuis des trackers publics',
  'scripts.theirs':
    'Ce sont ses propres scripts, pas ceux de KoBox : la synchronisation de chaque dossier suit son propre réglage et n’est pas concernée.',
  'scripts.checkbox':
    'Exécuter les scripts de {name} après un téléchargement terminé',
  'quota.scope':
    'Ce changement ne concerne que {name}. Descendre en dessous de ce qui est déjà stocké ne supprime rien : cela empêche seulement d’écrire davantage.',
  'recycling.intro':
    'Quand {name} ajoute un torrent dont un autre membre a déjà les fichiers ici, KoBox peut les réutiliser au lieu de retélécharger les mêmes octets.',
  'recycling.tradeoff':
    'Copier dépense du disque pour économiser de la bande passante, et chaque membre garde ses propres octets : son quota continue de dire ce qu’il dit. Partager ne dépense presque rien et casse justement cela : les mêmes blocs sont comptés une seule fois, pour celui à qui le système de fichiers les attribue, et un membre qui supprime son torrent ne libère rien tant qu’un autre pointe encore dessus. Ce réglage ne vaut que pour les ajouts à venir.',
  'nextcloud.what':
    'Donne à {name} un compte Nextcloud avec ses trois dossiers rTorrent à la racine, pour que le client de bureau puisse y déposer un fichier torrent depuis sa propre machine. Les membres sont des utilisateurs ordinaires ; seuls les administrateurs du portail administrent Nextcloud.',
  'nextcloud.password':
    'Le mot de passe Nextcloud est le sien et lui est envoyé par mail. KoBox ne garde le mot de passe du portail que sous forme d’empreinte et n’a rien à réutiliser : prétendre que les deux sont identiques serait mentir sur leur rapport.',
  'storage.using': 'Utilise {used} Gio sur {allowance} Gio',
  'storage.measured': 'mesuré le {at}',

};


// The English side of the keyed entries. An English string is its own key, so
// only the dotted ones need a row here; without it they would render as
// `members.intro` to an English reader, which is the failure mode this whole
// design exists to avoid.
const EN: Readonly<Record<string, string>> = {
  'members.intro':
    'Everyone with an account on the box. Creating one provisions a real system account, its own rTorrent instance on its own port, a home directory with a quota, and a VPN profile, then mails them a temporary password they are forced to change on first sign-in. SCGI is the port their ruTorrent talks to; it is shown because it is what you need when something is wrong, and it is preserved if they are ever migrated.',
  'members.suspend':
    'Suspending is reversible and cuts access without touching a single file: their transfers stop, their data stays. Deleting is not reversible.',
  'trackers.public.why':
    'Public trackers are watched by anti-piracy monitors, which is why this stays off unless someone asks for it. Torrents already added are not touched.',
  'trackers.public.checkbox': 'Let {name} add torrents from public trackers',
  'scripts.theirs':
    "These are their own scripts, not KoBox's: each folder's sync follows its own setting and is unaffected by this.",
  'scripts.checkbox': "Run {name}'s own scripts after a finished download",
  'quota.scope':
    'Changing this affects {name} and nobody else. Lowering it below what they already store does not delete anything; it stops them writing more.',
  'recycling.intro':
    'When {name} adds a torrent whose files another member already has here, KoBox can reuse them instead of downloading the same bytes again.',
  'recycling.tradeoff':
    'Copy spends disk to save bandwidth, and every member still holds their own bytes, so their quota keeps meaning what it says. Sharing spends almost nothing, and breaks that: the same blocks are counted once, for whoever the filesystem happens to attribute them to, and one member deleting their torrent frees nothing while another still points at the files. Changing this affects future adds only.',
  'nextcloud.what':
    'Gives {name} a Nextcloud account with their three rTorrent folders at its root, so the desktop client can drop a torrent file in from their own machine. Members are ordinary Nextcloud users; only portal admins administer it.',
  'nextcloud.password':
    'The Nextcloud password is its own and is mailed to them. KoBox keeps the portal password as a hash and has nothing to reuse, so pretending the two are the same would be a lie about how they relate.',
  'storage.using': 'Using {used} GiB of {allowance} GiB',
  'storage.measured': 'measured {at}',
};

const CATALOGUES: Readonly<Record<string, Readonly<Record<string, string>>>> = { en: EN, fr: FR };

// Values are substituted after lookup, so a translated sentence can put them
// wherever its own grammar needs them rather than where English happened to.
export type Translate = (english: string, values?: Readonly<Record<string, string>>) => string;

function fill(template: string, values: Readonly<Record<string, string>> | undefined): string {
  if (values === undefined) {
    return template;
  }
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

export function translatorFor(language: Language): Translate {
  const catalogue = CATALOGUES[language.value];
  return (english, values) => fill(catalogue?.[english] ?? english, values);
}
