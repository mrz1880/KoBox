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
  'Same as my browser': 'Comme mon navigateur',
  // a language is offered in its own name, so a reader lost in the other one
  // still finds theirs
  English: 'English',
  'French (Français)': 'Français',

  // signing in
  'Sign in': 'Se connecter',
  'Forgot your password?': 'Mot de passe oublié ?',
  'Your code': 'Votre code',
  'The 6-digit code from your authenticator app':
    'Le code à 6 chiffres de votre application d’authentification',
  Cancel: 'Annuler',
  'Username or email address': 'Identifiant ou adresse mail',
  'Send me a link': 'Envoyez-moi un lien',
  'Back to sign in': 'Retour à la connexion',
  'Check your mailbox': 'Vérifiez votre boîte mail',
  'If an account matches, a link to choose a new password is on its way. It works once and for one hour.':
    'Si un compte correspond, un lien pour choisir un nouveau mot de passe est en route. Il sert une seule fois, pendant une heure.',
  'This link no longer works': 'Ce lien ne fonctionne plus',
  'Ask for a new one, it only takes a moment.':
    'Demandez-en un nouveau, ça ne prend qu’un instant.',
  'Get a new link': 'Recevoir un nouveau lien',
  'Choose your password': 'Choisissez votre mot de passe',
  'New password': 'Nouveau mot de passe',
  'The same again': 'Le même, une seconde fois',
  'Save my password': 'Enregistrer mon mot de passe',
  'It opens the portal, Nextcloud and the network share.':
    'Il ouvre le portail, Nextcloud et le partage réseau.',
  'Please fill in both fields.': 'Merci de remplir les deux champs.',
  'The two passwords do not match.': 'Les deux mots de passe ne correspondent pas.',
  'Please choose another password: {reason}.':
    'Choisissez un autre mot de passe ({reason}).',
  'Password saved': 'Mot de passe enregistré',
  'It takes effect everywhere within a few seconds.':
    'Il s’applique partout d’ici quelques secondes.',
  'Invalid credentials.': 'Identifiants incorrects.',
  'This account is suspended.': 'Ce compte est suspendu.',
  'Too many attempts: account temporarily locked.':
    'Trop de tentatives : compte temporairement bloqué.',
  'That code did not work. Try the current one.':
    'Ce code ne fonctionne pas. Essayez celui affiché en ce moment.',

  // what just happened, shown once after a form
  'Saved.': 'Enregistré.',
  'Two-step sign-in is on.': 'La connexion en deux étapes est activée.',
  'Two-step sign-in is off.': 'La connexion en deux étapes est désactivée.',
  'That code did not work. Set it up again.':
    'Ce code ne fonctionne pas. Recommencez la configuration.',
  'That code did not work: it stays on.': 'Ce code ne fonctionne pas : elle reste activée.',
  'Set up two-step sign-in to open Administration.':
    'Activez la connexion en deux étapes pour ouvrir l’Administration.',
  'That does not look like a public key.': 'Cela ne ressemble pas à une clé publique.',
  'Key removed.': 'Clé retirée.',
  'Address added.': 'Adresse ajoutée.',
  'Address removed.': 'Adresse retirée.',
  'You are connecting over IPv6. Only IPv4 addresses can be declared.':
    'Vous êtes connecté en IPv6. Seules les adresses IPv4 peuvent être déclarées.',
  'Updating blocklists.': 'Mise à jour des listes de blocage.',
  'That token no longer works anywhere.': 'Ce jeton ne fonctionne plus nulle part.',
  'That one is already gone.': 'Celui-ci n’est déjà plus là.',
  'That is not an IPv4 address, like 203.0.113.20.':
    'Ce n’est pas une adresse IPv4, comme 203.0.113.20.',
  'That is not a hostname, like myhome.duckdns.org. For a fixed address, use the field above.':
    'Ce n’est pas un nom d’hôte, comme myhome.duckdns.org. Pour une adresse fixe, utilisez le champ au-dessus.',
  'That address only exists inside a home or office network. Declare the one that place shows to the internet.':
    'Cette adresse n’existe qu’à l’intérieur d’un réseau domestique ou de bureau. Déclarez celle que ce lieu montre à internet.',
  'Testing the connection.': 'Test de la connexion.',
  'Test message queued. It goes out on the next send pass, within five minutes.':
    'Message de test en file. Il part au prochain envoi, d’ici cinq minutes.',
  'Saved. Test it before you rely on it.': 'Enregistré. Testez-le avant de compter dessus.',
  'Saved. Run kobox install on the box to request the certificate.':
    'Enregistré. Lancez kobox install sur la box pour demander le certificat.',
  'Saved. It applies to what they add from now on, and changes nothing already on disk.':
    'Enregistré. Cela s’applique à ce qu’il ajoutera désormais, et ne change rien de ce qui est déjà sur le disque.',
  'Restarting your rtorrent.': 'Redémarrage de votre rtorrent.',
  'Renewing certificates.': 'Renouvellement des certificats.',
  'Removing it now.': 'Suppression en cours.',
  'Relay saved. Applying it now.': 'Relais enregistré. Application en cours.',
  'Putting it back in the queue.': 'Remise en file d’attente.',
  'Password change under way: it takes a few seconds.':
    'Changement de mot de passe en cours : cela prend quelques secondes.',
  'Override applied.': 'Dérogation appliquée.',
  'Measuring the link.': 'Mesure du lien en cours.',
  'Key saved.': 'Clé enregistrée.',
  'Key accepted. It is being installed.': 'Clé acceptée. Elle est en cours d’installation.',
  'Installing the updates.': 'Installation des mises à jour.',
  'Importing the catalog.': 'Import du catalogue.',
  'Hostname removed.': 'Nom d’hôte retiré.',
  'Hostname added. Its address opens within five minutes.':
    'Nom d’hôte ajouté. Son adresse s’ouvre d’ici cinq minutes.',
  'Download started. It will appear in the list below.':
    'Téléchargement lancé. Il apparaîtra dans la liste ci-dessous.',
  'Checking for updates.': 'Recherche de mises à jour.',
  'An update is already running.': 'Une mise à jour est déjà en cours.',
  'A test is already running.': 'Un test est déjà en cours.',
  'A measurement is already running.': 'Une mesure est déjà en cours.',
  'A check is already running.': 'Une vérification est déjà en cours.',
  'Your current password is incorrect.': 'Votre mot de passe actuel est incorrect.',
  'Please fill in both passwords.': 'Merci de remplir les deux mots de passe.',
  "That doesn't look like an AllDebrid API key.":
    'Cela ne ressemble pas à une clé d’API AllDebrid.',
  'Please provide a valid http(s) link and a category.':
    'Merci de donner un lien http(s) valide et une catégorie.',
  'A relay needs a hostname, a port between 1 and 65535, a login and a password.':
    'Un relais a besoin d’un nom d’hôte, d’un port entre 1 et 65535, d’un identifiant et d’un mot de passe.',
  'That is not a hostname. Give the name on its own, with no https:// and no trailing slash.':
    'Ce n’est pas un nom d’hôte. Donnez le nom seul, sans https:// ni barre oblique finale.',

  // member pages
  Torrents: 'Torrents',
  ruTorrent: 'ruTorrent',
  'Download a link': 'Télécharger un lien',
  Open: 'Ouvrir',
  'Hello {name}': 'Bonjour {name}',
  'My account and connection details': 'Mon compte et mes informations de connexion',
  'Add a torrent and follow it. This is the main tool.':
    'Ajoutez un torrent et suivez-le. C’est l’outil principal.',
  'Watch or download what has finished.': 'Regardez ou téléchargez ce qui est terminé.',
  'Paste a link from a file host and let the server fetch it.':
    'Collez un lien d’hébergeur et laissez le serveur le récupérer.',
  'Your account is suspended. Contact the administrator to have it restored.':
    'Votre compte est suspendu. Contactez l’administrateur pour le faire rétablir.',
  'Your torrent client is not running. {restart}.':
    'Votre client torrent ne tourne pas. {restart}.',
  'Restart it from the ruTorrent page': 'Relancez-le depuis la page ruTorrent',
  'Your connection is temporarily slowed because of heavy use. It lifts on its own once traffic settles.':
    'Votre connexion est ralentie pour un temps à cause d’une forte utilisation. Cela se lève tout seul quand le trafic se calme.',
  'You are using a lot of bandwidth right now. Nothing is limited yet.':
    'Vous utilisez beaucoup de bande passante en ce moment. Rien n’est encore limité.',
  'Everything is running.': 'Tout fonctionne.',
  'Current password': 'Mot de passe actuel',
  'Restart my rtorrent': 'Redémarrer mon rtorrent',
  'Use this if the interface stops responding.': 'À utiliser si l’interface ne répond plus.',
  'Back to my media': 'Retour à mes médias',
  'Download this file': 'Télécharger ce fichier',
  'You have no folders yet. Create one under {folders}, and what lands in it shows up here.':
    'Vous n’avez pas encore de dossier. Créez-en un dans {folders}, et ce qui y arrive apparaîtra ici.',
  'You have no folders yet. Create one under {folders} and it will show up here.':
    'Vous n’avez pas encore de dossier. Créez-en un dans {folders} et il apparaîtra ici.',
  done: 'terminé',
  failed: 'en échec',
  downloading: 'en cours',
  pending: 'en attente',
  'My AllDebrid account': 'Mon compte AllDebrid',
  'Status: {state}': 'État : {state}',
  'key configured': 'clé configurée',
  'no key': 'pas de clé',
  'Your key is stored encrypted and is only used for your own downloads. Without one, downloads stay unavailable for you, and nothing else changes.':
    'Votre clé est stockée chiffrée et ne sert qu’à vos propres téléchargements. Sans clé, les téléchargements vous restent fermés, et rien d’autre ne change.',
  'Replace my key': 'Remplacer ma clé',
  'My AllDebrid API key': 'Ma clé d’API AllDebrid',
  'Remove my key': 'Retirer ma clé',
  'The download engine is {notSetUp}, so links will not go anywhere. This is not something you can fix from here: tell an admin, and they will find the reason under Health.':
    'Le moteur de téléchargement {notSetUp}, les liens n’iront donc nulle part. Ce n’est pas réparable d’ici : prévenez un administrateur, il trouvera la raison dans État du système.',
  'not set up on this box': 'n’est pas installé sur cette box',
  'Simplest': 'Le plus simple',
  'Three ways to reach your files. All of them take your username, {username}, and the password you use here.':
    'Trois façons d’accéder à vos fichiers. Toutes demandent votre identifiant, {username}, et le mot de passe que vous utilisez ici.',
  'In the browser, or in the Nextcloud app on a phone or a computer. No VPN, nothing to set up on your network.':
    'Dans le navigateur, ou dans l’application Nextcloud sur un téléphone ou un ordinateur. Pas de VPN, rien à configurer sur votre réseau.',
  'Open Nextcloud': 'Ouvrir Nextcloud',
  'Nextcloud is not installed on this box. Ask an administrator.':
    'Nextcloud n’est pas installé sur cette box. Demandez à un administrateur.',
  'For FileZilla, Cyberduck or rsync, and for large transfers.':
    'Pour FileZilla, Cyberduck ou rsync, et pour les gros transferts.',
  'Network share': 'Partage réseau',
  'Samba, like a local disk. Connect the VPN with the usual profile first ({account}), then open:':
    'Samba, comme un disque local. Connectez d’abord le VPN avec le profil habituel ({account}), puis ouvrez :',

  // account: VPN, app token, two-step, addresses, key
  'Connect over VPN': 'Se connecter par VPN',
  'Download one profile and open it with your OpenVPN client.':
    'Téléchargez un profil et ouvrez-le avec votre client OpenVPN.',
  'Usual choice': 'Choix habituel',
  'Download profile': 'Télécharger le profil',
  'Everything through the seedbox': 'Tout passe par la seedbox',
  'All your traffic leaves through the server. Pick this one unless you have a reason not to.':
    'Tout votre trafic sort par le serveur. Prenez celui-ci, sauf raison particulière.',
  'Seedbox traffic only': 'Seulement le trafic de la seedbox',
  'Only what you send to the seedbox goes through the tunnel. The rest uses your normal connection.':
    'Seul ce que vous envoyez à la seedbox passe par le tunnel. Le reste utilise votre connexion habituelle.',
  'Bridged network': 'Réseau ponté',
  'Puts your machine on the same network as the server. Rarely needed.':
    'Place votre machine sur le même réseau que le serveur. Rarement utile.',
  'SFTP host': 'Hôte SFTP',
  'rtorrent port': 'Port rtorrent',
  'Your SFTP password is the one you use here.':
    'Votre mot de passe SFTP est celui que vous utilisez ici.',
  'Open ruTorrent': 'Ouvrir ruTorrent',
  'Connect an app': 'Connecter une application',
  'Sonarr, Radarr and friends can add torrents for you and follow them. They sign in with your username and a {token} instead of your password, so a program that leaks its settings costs you the token and not your account. Throw it away here and it stops working immediately, everywhere.':
    'Sonarr, Radarr et compagnie peuvent ajouter des torrents pour vous et les suivre. Ils se connectent avec votre identifiant et un {token} au lieu de votre mot de passe : un programme qui laisse fuiter ses réglages vous coûte le jeton, pas votre compte. Jetez-le ici et il cesse aussitôt de fonctionner, partout.',
  token: 'jeton',
  'Here is your token. Copy it now.': 'Voici votre jeton. Copiez-le maintenant.',
  'It will not be shown again. KoBox only keeps a fingerprint of it. If you lose it, make a new one; the old one stops working at that moment.':
    'Il ne sera plus affiché. KoBox n’en garde qu’une empreinte. Si vous le perdez, créez-en un nouveau : l’ancien cesse alors de fonctionner.',
  "In the app, choose {client}, use your own username, paste the token where it asks for a password, and point it at this box on port {port} with the path {path}. If you would rather not connect anything, dropping a .torrent file into a folder's {watch} directory works just as well.":
    'Dans l’application, choisissez {client}, utilisez votre propre identifiant, collez le jeton là où elle demande un mot de passe, et dirigez-la vers cette box sur le port {port} avec le chemin {path}. Si vous préférez ne rien connecter, déposer un fichier .torrent dans le répertoire {watch} d’un dossier marche tout aussi bien.',
  'Make a new token': 'Créer un nouveau jeton',
  'Make a token': 'Créer un jeton',
  'Throw it away': 'Le jeter',
  'After your password, a 6-digit code from an app on your phone (Aegis, Google Authenticator, 1Password...). Someone who learns your password still cannot sign in. Administrators need it to open Administration.':
    'Après votre mot de passe, un code à 6 chiffres donné par une application sur votre téléphone (Aegis, Google Authenticator, 1Password...). Quelqu’un qui apprendrait votre mot de passe ne pourrait toujours pas se connecter. Les administrateurs en ont besoin pour ouvrir l’Administration.',
  On: 'Activée',
  'current code': 'code actuel',
  'Turn it off': 'La désactiver',
  'Set it up': 'La configurer',
  'Add this key to your authenticator app.':
    'Ajoutez cette clé à votre application d’authentification.',
  'On the phone that has the app, this link adds it directly: {link}':
    'Sur le téléphone qui a l’application, ce lien l’ajoute directement : {link}',
  'Then type the code the app shows': 'Puis tapez le code affiché par l’application',
  'Turn it on': 'L’activer',
  'Not now': 'Pas maintenant',
  'SSH and SFTP accept connections from the addresses below and from the VPN. Add your address from home, from the place your scripts or your NAS run. Only you and the administrators see this list.':
    'SSH et SFTP acceptent les connexions depuis les adresses ci-dessous et depuis le VPN. Ajoutez votre adresse à la maison, celle de l’endroit où tournent vos scripts ou votre NAS. Seuls vous et les administrateurs voyez cette liste.',
  'No address declared.': 'Aucune adresse déclarée.',
  'You are connecting over IPv6 right now. Only IPv4 addresses can be declared: come back from a connection that uses IPv4.':
    'Vous êtes connecté en IPv6 en ce moment. Seules les adresses IPv4 peuvent être déclarées : revenez depuis une connexion en IPv4.',
  'You are connecting from {address}, which is declared.':
    'Vous vous connectez depuis {address}, qui est déclarée.',
  'You are connecting from {address}.': 'Vous vous connectez depuis {address}.',
  'Add this address': 'Ajouter cette adresse',
  'Another place': 'Un autre lieu',
  Add: 'Ajouter',
  'For a place you are not at right now, your NAS at home or the office: type the public address it shows to the internet (a site like whatismyip.com, opened from there, tells you).':
    'Pour un lieu où vous n’êtes pas en ce moment, votre NAS à la maison ou le bureau : tapez l’adresse publique qu’il montre à internet (un site comme whatismyip.com, ouvert depuis là-bas, vous la donne).',
  'Dynamic hostname': 'Nom d’hôte dynamique',
  'If your home address changes on its own, give a name your router or a service like DuckDNS keeps pointed at it. The box looks it up every five minutes and follows it.':
    'Si votre adresse à la maison change toute seule, donnez un nom que votre routeur ou un service comme DuckDNS garde pointé dessus. La box le consulte toutes les cinq minutes et le suit.',
  'not looked up yet': 'pas encore consulté',
  'points at {address}': 'pointe vers {address}',
  Hostname: 'Nom d’hôte',
  'No key installed. Add your public key and a script on your own machine can drop torrent files straight into your folders, without a password.':
    'Aucune clé installée. Ajoutez votre clé publique et un script sur votre machine pourra déposer des fichiers torrent directement dans vos dossiers, sans mot de passe.',
  'Installed: {key}': 'Installée : {key}',
  'since {date}': 'depuis le {date}',
  'The {public} half, the one line from {file}. Never paste a private key here or anywhere else. This key transfers files and cannot open a shell, which is all a send-my-torrents script needs.':
    'La moitié {public}, l’unique ligne de {file}. Ne collez jamais une clé privée ici, ni ailleurs. Cette clé transfère des fichiers et ne peut pas ouvrir de shell, ce qui suffit à un script qui envoie vos torrents.',
  public: 'publique',
  "With the key installed, send a torrent file over SFTP into one of your folders (replace FOLDER with its name, as listed under Folders); rTorrent picks it up within a few seconds and gives it that folder's label:":
    'Une fois la clé installée, envoyez un fichier torrent par SFTP dans un de vos dossiers (remplacez FOLDER par son nom, tel qu’il apparaît dans Dossiers) ; rTorrent le prend en charge en quelques secondes et lui donne l’étiquette de ce dossier :',

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

// The fallback to English keeps a page whole, so a missing line shows nowhere;
// this is how a test finds one.
export function hasFrench(english: string): boolean {
  return Object.hasOwn(FR, english);
}

export function translatorFor(language: Language): Translate {
  const catalogue = CATALOGUES[language.value];
  return (english, values) => fill(catalogue?.[english] ?? english, values);
}
