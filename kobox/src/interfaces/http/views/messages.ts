import type { Language } from '../../../domain/portal/Language.js';

// The English string is the key. Two reasons: nothing has to invent an
// identifier, and a missing translation renders the English rather than a
// `page.title.missing` staring back at somebody. Adding a language means adding
// a column here; forgetting a line costs that line, never the page.
const FR: Readonly<Record<string, string>> = {
  // navigation
  Home: 'Accueil',
  'My media': 'Mes médias',
  'My files': 'Mes fichiers',
  'In the browser': 'Dans le navigateur',
  'Plays here': 'Se lit ici',
  'Download to watch': 'À télécharger',
  'Full screen': 'Plein écran',
  '{container}: browsers do not play it': '{container} : les navigateurs ne le lisent pas',
  'Your seedbox at a glance': 'Ta seedbox en un coup d’œil',
  'Nextcloud, SFTP, network share': 'Nextcloud, SFTP, partage réseau',
  'Watch in the browser': 'Regarder dans le navigateur',
  'Your categories': 'Tes catégories',
  'Through AllDebrid': 'Via AllDebrid',
  'Password, VPN, keys': 'Mot de passe, VPN, clés',
  'What needs you': 'Ce qui demande une action',
  'Invite, quotas, roles': 'Inviter, quotas, rôles',
  'Addresses, trackers, blocklists': 'Adresses, trackers, listes de blocage',
  'Mail, domain, updates': 'Mails, domaine, mises à jour',
  'Services and monitoring': 'Services et monitoring',
  'Logs, generated files': 'Journaux, fichiers générés',
  'My seedbox': 'Ma seedbox',
  Administration: 'Administration',
  Members: 'Membres',
  'Network & security': 'Réseau et sécurité',
  System: 'Système',
  Troubleshooting: 'Dépannage',
  Menu: 'Menu',
  Space: 'Espace',
  Downloads: 'Téléchargements',
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
  Remove: 'Retirer',
  'Nothing here yet. Submit a link above to start.':
    'Rien pour l’instant. Collez un lien ci-dessus pour commencer.',

  // account
  'My access': 'Mon accès',
  'Your details': 'Vos informations',
  Username: 'Identifiant',
  Files: 'Fichiers',
  'Change password': 'Changer de mot de passe',
  'Your own SSH key': 'Votre clé SSH',
  'Where you connect from': 'D’où tu te connectes',
  'Two-step sign-in': 'Connexion en deux étapes',
  'Public key': 'Clé publique',
  'Install this key': 'Installer cette clé',
  'Remove it': 'La retirer',
  Language: 'Langue',
  'Save language': 'Enregistrer la langue',
  English: 'Anglais',
  'French (Français)': 'Français',

  // admin navigation
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
  Quota: 'Quota',
  Role: 'Rôle',
  Administrator: 'Administrateur',
  Member: 'Membre',
  'No portal login': 'Pas d’accès au portail',
  SCGI: 'SCGI',
  'Invite a member': 'Inviter un membre',
  'Send the invitation': 'Envoyer l’invitation',
  'Send the link again': 'Renvoyer le lien',
  invited: 'invité',
  'Quota (GiB)': 'Quota (Gio)',
  'Portal role': 'Rôle sur le portail',
  Suspend: 'Suspendre',
  Resume: 'Réactiver',
  'Delete (irreversible)': 'Supprimer (irréversible)',
  Storage: 'Stockage',
  'Allowance (GiB)': 'Allocation (Gio)',
  Save: 'Enregistrer',
  'Public trackers': 'Trackers publics',
  'Their own scripts': 'Leurs propres scripts',
  Nextcloud: 'Nextcloud',
  'Resend the invitation': "Renvoyer l'invitation",
  'Send a reset link': 'Envoyer un lien de réinitialisation',
  'Reusing what is already here': 'Réutiliser ce qui est déjà là',
  'What to do': 'Que faire',
  'Download it again (default)': 'Le retélécharger (par défaut)',
  'Copy the files, so they get their own': 'Copier les fichiers, chacun a les siens',
  'Share the same files on disk': 'Partager les mêmes fichiers sur le disque',
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
    'Toutes les personnes ayant un compte sur la machine. En créer un provisionne un vrai compte système, sa propre instance rTorrent sur son propre port, un répertoire personnel avec un quota et un profil VPN, puis lui envoie par mail un lien pour choisir son mot de passe ; personne d’autre ne le connaît. Le port SCGI est celui auquel parle son ruTorrent ; il est affiché parce que c’est ce dont vous avez besoin quand quelque chose cloche, et il est conservé en cas de migration.',
  'admin.band':
    'Administration : les réglages de toute la box et de tous les membres. Ce que vous changez ici concerne tout le monde.',
  'media.playback':
    'Les vidéos MP4 et WebM se lisent dans le navigateur. Les autres, MKV en tête, se téléchargent pour être lues dans VLC, Infuse ou sur la télé. Rien n’est réencodé.',
  'members.invite':
    'Il reçoit un mail avec un lien pour choisir son mot de passe, valable 7 jours ; la page suivante vous le donne aussi, pour le lui envoyer vous-même. Son compte reste fermé tant qu’il ne l’a pas utilisé.',
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
  'password.invited':
    "{name} n'a pas encore choisi son mot de passe. Renvoyer l'invitation remplace le lien précédent, et vous le montre pour le transmettre autrement.",
  'password.active':
    "Personne ne connaît le mot de passe de {name}, pas même vous : un lien par mail lui permet d'en choisir un nouveau.",
  'nextcloud.what':
    '{name} se connecte à Nextcloud et au partage réseau avec le mot de passe du portail : son compte Nextcloud est créé avec, ses trois dossiers rTorrent à la racine, et suit chacun de ses changements. Les membres sont des utilisateurs ordinaires ; seuls les administrateurs du portail administrent Nextcloud.',
  'storage.using': 'Utilise {used} Gio sur {allowance} Gio',
  'storage.measured': 'mesuré le {at}',
  'role.what':
    'Un administrateur voit tous les membres et pilote la machine d’ici ; un membre ne voit que son propre compte. Le changement s’applique dès sa page suivante, et décide aussi s’il administre Nextcloud.',
  'role.none':
    'Ce compte n’a pas encore d’accès au portail. Donnez-lui un mot de passe pour lui en ouvrir un.',

};


// The English side of the keyed entries. An English string is its own key, so
// only the dotted ones need a row here; without it they would render as
// `members.intro` to an English reader, which is the failure mode this whole
// design exists to avoid.
const EN: Readonly<Record<string, string>> = {
  'members.intro':
    'Everyone with an account on the box. Creating one provisions a real system account, its own rTorrent instance on its own port, a home directory with a quota, and a VPN profile, then mails them a link to choose their password; nobody else ever knows it. SCGI is the port their ruTorrent talks to; it is shown because it is what you need when something is wrong, and it is preserved if they are ever migrated.',
  'admin.band':
    'Administration: the settings of the whole box and of every member. What you change here affects everyone.',
  'media.playback':
    'MP4 and WebM videos play in the browser. The others, MKV first, are downloaded and played in VLC, Infuse or on the TV. Nothing is re-encoded.',
  'members.invite':
    'They get a mail with a link to choose their password, valid 7 days; the next page gives you the link too, to send it yourself. Their account stays closed until they use it.',
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
  'password.invited':
    "{name} has not chosen a password yet. Resending the invitation replaces the previous link, and shows it to you to pass on another way.",
  'password.active':
    "Nobody knows {name}'s password, you included: a link by mail lets them choose a new one.",
  'nextcloud.what':
    '{name} signs in to Nextcloud and to the network share with their portal password: their Nextcloud account is created with it, their three rTorrent folders at its root, and follows every change of it. Members are ordinary Nextcloud users; only portal admins administer it.',
  'storage.using': 'Using {used} GiB of {allowance} GiB',
  'storage.measured': 'measured {at}',
  'role.what':
    'An admin sees every member and runs the box from here; a member sees only their own account. It applies from their next page, and it also decides whether they administer Nextcloud.',
  'role.none':
    'This account has no portal login yet. Give it a password to open one.',
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
