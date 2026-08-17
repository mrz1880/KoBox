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
};

const CATALOGUES: Readonly<Record<string, Readonly<Record<string, string>>>> = { fr: FR };

export type Translate = (english: string) => string;

export function translatorFor(language: Language): Translate {
  const catalogue = CATALOGUES[language.value];
  if (catalogue === undefined) {
    return (english) => english;
  }
  return (english) => catalogue[english] ?? english;
}
