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
  'Your seedbox at a glance': 'Votre seedbox en un coup d’œil',
  'Nextcloud, SFTP, network share': 'Nextcloud, SFTP, partage réseau',
  'Watch in the browser': 'Regarder dans le navigateur',
  'Your categories': 'Vos catégories',
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
  Folders: 'Dossiers',
  Account: 'Mon compte',
  'Sign out': 'Se déconnecter',
  Overview: 'Vue d’ensemble',

  // my media
  'Empty for now.': 'Vide pour le moment.',
  File: 'Fichier',
  Size: 'Taille',
  Watch: 'Regarder',
  Download: 'Télécharger',
  'Loose files': 'Fichiers isolés',

  // shared table words
  Folder: 'Dossier',
  Status: 'État',
  Detail: 'Détail',
  Remove: 'Retirer',

  // account
  'Your details': 'Vos informations',
  Username: 'Identifiant',
  Files: 'Fichiers',
  'Change password': 'Changer de mot de passe',
  'Your own SSH key': 'Votre clé SSH',
  'Where you connect from': 'D’où vous vous connectez',
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
  'Please choose another new password: {reason}.':
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
  'Relay saved. Applying it now.': 'Relais enregistré. Application en cours.',
  'Putting it back in the queue.': 'Remise en file d’attente.',
  'Password change under way: it takes a few seconds.':
    'Changement de mot de passe en cours : cela prend quelques secondes.',
  'Override applied.': 'Dérogation appliquée.',
  'Measuring the link.': 'Mesure du lien en cours.',
  'Key accepted. It is being installed.': 'Clé acceptée. Elle est en cours d’installation.',
  'Installing the updates.': 'Installation des mises à jour.',
  'Importing the catalog.': 'Import du catalogue.',
  'Hostname removed.': 'Nom d’hôte retiré.',
  'Hostname added. Its address opens within five minutes.':
    'Nom d’hôte ajouté. Son adresse s’ouvre d’ici cinq minutes.',
  'Checking for updates.': 'Recherche de mises à jour.',
  'An update is already running.': 'Une mise à jour est déjà en cours.',
  'A test is already running.': 'Un test est déjà en cours.',
  'A measurement is already running.': 'Une mesure est déjà en cours.',
  'A check is already running.': 'Une vérification est déjà en cours.',
  'Your current password is incorrect.': 'Votre mot de passe actuel est incorrect.',
  'Please fill in both passwords.': 'Merci de remplir les deux mots de passe.',
  'A relay needs a hostname, a port between 1 and 65535, a login and a password.':
    'Un relais a besoin d’un nom d’hôte, d’un port entre 1 et 65535, d’un identifiant et d’un mot de passe.',
  'That is not a hostname. Give the name on its own, with no https:// and no trailing slash.':
    'Ce n’est pas un nom d’hôte. Donnez le nom seul, sans https:// ni barre oblique finale.',

  // member pages
  Torrents: 'Torrents',
  ruTorrent: 'ruTorrent',
  Open: 'Ouvrir',
  'Hello {name}': 'Bonjour {name}',
  'My account and connection details': 'Mon compte et mes informations de connexion',
  'Add a torrent and follow it. This is the main tool.':
    'Ajoutez un torrent et suivez-le. C’est l’outil principal.',
  'Watch or download what has finished.': 'Regardez ou téléchargez ce qui est terminé.',
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
  '{free} free of your {allowance} ({used} used), measured {at}.':
    '{free} libres sur vos {allowance} ({used} utilisés), mesuré le {at}.',
  'The box is running out of disk, so your allowance can no longer be reached.':
    'Le disque de la box arrive à saturation : votre allocation ne peut plus être atteinte.',
  'Space not measured yet.': 'Espace pas encore mesuré.',
  'Saving your change. This page refreshes by itself until it is done.':
    'Enregistrement en cours. Cette page se recharge toute seule jusqu’à ce que ce soit fait.',
  'This change could not be applied. An administrator can find why under Troubleshooting.':
    'Ce changement n’a pas pu être appliqué. Un administrateur en trouvera la raison dans Dépannage.',
  'No component installed yet.': 'Aucun composant installé pour l’instant.',
  'No release deployed yet.': 'Aucune version déployée pour l’instant.',
  'No event recorded yet.': 'Aucun événement enregistré pour l’instant.',
  staged: 'préparée',
  'in service': 'en service',
  previous: 'précédente',
  'not yet': 'pas encore',
  'Current password': 'Mot de passe actuel',
  'Restart my rtorrent': 'Redémarrer mon rtorrent',
  'Use this if the interface stops responding.': 'À utiliser si l’interface ne répond plus.',
  'Back to my media': 'Retour à mes médias',
  'Download this file': 'Télécharger ce fichier',
  'You have no folders yet. Create one under {folders}, and what lands in it shows up here.':
    'Vous n’avez pas encore de dossier. Créez-en un dans {folders}, et ce qui y arrive apparaîtra ici.',
  failed: 'en échec',
  pending: 'en attente',
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

  // folders and sending to a member's own machine
  "A folder is what you sort your downloads into. Drop a torrent in a folder's watch directory and what comes out lands in that folder, and, if you ask for it here, gets copied on to your own machine.":
    'Un dossier, c’est là où vous rangez vos téléchargements. Déposez un torrent dans le répertoire watch d’un dossier et ce qui en sort arrive dans ce dossier, puis, si vous le demandez ici, est copié jusqu’à votre propre machine.',
  'You have no folders yet.': 'Vous n’avez pas encore de dossier.',
  'When a download finishes': 'Quand un téléchargement se termine',
  'Add a folder': 'Ajouter un dossier',
  'Add it': 'L’ajouter',
  'Letters, digits, dot, dash or underscore: no spaces and no accents, because it becomes a folder name on this box and on your own machine. New folders keep everything here until you say otherwise.':
    'Lettres, chiffres, point, tiret ou tiret bas : ni espace ni accent, car le nom devient un nom de dossier sur cette box et sur votre machine. Un nouveau dossier garde tout ici tant que vous ne dites pas autre chose.',
  'Keep it here': 'Le garder ici',
  'Nothing leaves the box. Download it yourself whenever you like.':
    'Rien ne quitte la box. Téléchargez-le vous-même quand vous voulez.',
  'Send it a bit later': 'L’envoyer un peu plus tard',
  'It goes out on the next pass, a few minutes after it finishes.':
    'Il part au prochain passage, quelques minutes après la fin du téléchargement.',
  'Send it straight away': 'L’envoyer tout de suite',
  'It starts copying the moment the download is done.':
    'La copie démarre dès que le téléchargement est terminé.',
  'What happens to a finished {folder} download':
    'Ce que devient un téléchargement terminé dans {folder}',
  'Send what is already here': 'Envoyer ce qui est déjà là',
  'Holds downloads: empty it to rename or remove it.':
    'Contient des téléchargements : videz-le pour le renommer ou le retirer.',
  'New name for {folder}': 'Nouveau nom pour {folder}',
  'new name': 'nouveau nom',
  Rename: 'Renommer',
  'Where your files go': 'Où vont vos fichiers',
  'The machine of yours KoBox copies finished downloads to: a NAS, a home server, anything that accepts an SSH connection. Each folder above lands in a folder of the same name over there.':
    'La machine à vous vers laquelle KoBox copie les téléchargements terminés : un NAS, un serveur à la maison, tout ce qui accepte une connexion SSH. Chaque dossier ci-dessus arrive là-bas dans un dossier du même nom.',
  'Not tried yet. Test it before you rely on it.':
    'Pas encore essayée. Testez-la avant de compter dessus.',
  'it works': 'ça marche',
  'it does not work': 'ça ne marche pas',
  'Last tried {at}.': 'Dernier essai le {at}.',
  'The machine identified itself as {fingerprint}: if that ever changes without you reinstalling it, KoBox will refuse to connect and say so.':
    'La machine s’est présentée comme {fingerprint} : si cela change un jour sans que vous l’ayez réinstallée, KoBox refusera de s’y connecter et le dira.',
  Address: 'Adresse',
  'Account there': 'Compte là-bas',
  'leave empty to keep the current one': 'laisser vide pour garder l’actuel',
  'Folder there': 'Dossier là-bas',
  'Files per pass': 'Fichiers par passage',
  'A download that is one single file': 'Un téléchargement fait d’un seul fichier',
  'Send the "a bit later" folders at': 'Envoyer les dossiers « un peu plus tard » à',
  'Mail me about a transfer': 'M’écrire au sujet d’un transfert',
  'Put the file straight in the folder': 'Mettre le fichier directement dans le dossier',
  'Give each file a folder of its own': 'Donner à chaque fichier son propre dossier',
  never: 'jamais',
  'only when one fails': 'seulement quand un envoi échoue',
  'every time, arrived or failed': 'à chaque fois, arrivé ou en échec',
  '0 files per pass means "everything waiting". Your password is sealed with this box\'s key the moment you save it: it is never stored in a form you can read back, and never appears in a command line.':
    '0 fichier par passage veut dire « tout ce qui attend ». Votre mot de passe est scellé avec la clé de cette box dès l’enregistrement : il n’est jamais stocké sous une forme relisible, et n’apparaît jamais dans une ligne de commande.',
  'Test it now': 'La tester maintenant',
  'Connects, then checks the folder can be written to. Takes a few seconds: reload the page for the answer.':
    'Se connecte, puis vérifie qu’on peut écrire dans le dossier. Cela prend quelques secondes : rechargez la page pour la réponse.',
  'What has been sent': 'Ce qui a été envoyé',
  'Nothing yet. Once a folder set to send finishes a download, it turns up here.':
    'Rien pour l’instant. Dès qu’un dossier réglé pour envoyer termine un téléchargement, il apparaît ici.',
  State: 'État',
  'What happened': 'Ce qui s’est passé',
  'Last change': 'Dernier changement',
  'waiting its turn': 'attend son tour',
  'on its way': 'en route',
  arrived: 'arrivé',
  'did not arrive': 'pas arrivé',
  'Try again': 'Réessayer',
  'Send again': 'Renvoyer',
  'A file that did not arrive stays here until you try it again: it is never silently dropped, and trying again resumes where it stopped rather than starting the file over.':
    'Un fichier qui n’est pas arrivé reste ici jusqu’à ce que vous réessayiez : il n’est jamais abandonné en silence, et réessayer reprend là où le transfert s’est arrêté au lieu de recommencer le fichier.',

  // flashes naming something, put in the reader's language at the redirect
  'Creating the {folder} folder.': 'Création du dossier {folder}.',
  'Saved what happens to {folder}.': 'Réglage de {folder} enregistré.',
  '{folder} keeps everything here. Choose when it goes out first.':
    '{folder} garde tout ici. Choisissez d’abord quand il part.',
  'Queuing what {folder} already holds. Anything already sent stays as it is.':
    'Mise en file de ce que contient déjà {folder}. Ce qui a déjà été envoyé reste tel quel.',
  '{folder} still holds downloads: they seed from its path. Remove them first, then the folder.':
    '{folder} contient encore des téléchargements : ils partagent depuis son chemin. Retirez-les d’abord, puis le dossier.',
  'Removing the {folder} folder.': 'Suppression du dossier {folder}.',
  'There is already a folder named {folder}.': 'Il existe déjà un dossier nommé {folder}.',
  'Renaming {from} to {to}.': 'Renommage de {from} en {to}.',
  '{name} already exists.': '{name} existe déjà.',
  'Deleting {name}.': 'Suppression de {name}.',
  'Suspending {name}.': 'Suspension de {name}.',
  'Restoring {name}.': 'Réactivation de {name}.',
  'A reset link is on its way to {name}.': 'Un lien de réinitialisation est en route vers {name}.',
  '{address} is a private address: no connection from the internet comes from it.':
    '{address} est une adresse privée : aucune connexion depuis internet n’en vient.',
  'Adding the address.': 'Ajout de l’adresse.',
  'Removing the address.': 'Retrait de l’adresse.',
  'Adding the hostname.': 'Ajout du nom d’hôte.',
  'Removing the hostname.': 'Retrait du nom d’hôte.',
  'Restarting {service}.': 'Redémarrage de {service}.',
  'Capturing the {service} journal.': 'Capture du journal de {service}.',
  'Updating {host}.': 'Mise à jour de {host}.',

  // refusal page
  Forbidden: 'Accès refusé',
  'This area requires the admin role.': 'Cet espace est réservé aux administrateurs.',
  'Invalid or missing CSRF token.':
    'Jeton de sécurité du formulaire absent ou invalide. Rechargez la page et recommencez.',

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
  Used: 'Utilisé',
  Free: 'Libre',
  'not measured': 'non mesuré',
  'limited by the disk': 'limité par le disque',
  'Disk: {free} free of {size}.': 'Disque : {free} libres sur {size}.',
  'Disk not measured yet.': 'Disque pas encore mesuré.',
  'Allowances add up to {allowances}.': 'Les allocations totalisent {allowances}.',
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
  '{free} left to fill.': '{free} encore disponibles.',
  '{free} left to fill: the box is running out of disk, so the allowance can no longer be reached.':
    '{free} encore disponibles : le disque de la box arrive à saturation, l’allocation ne peut plus être atteinte.',
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
  '{name} now has {gib} GiB. Nobody else is affected.':
    '{name} a maintenant {gib} Gio. Personne d’autre n’est concerné.',
  '{name} is now {role} on the portal.': '{name} est maintenant {role} sur le portail.',
  "{name}'s own scripts will run again after a download.":
    'Les scripts de {name} s’exécuteront de nouveau après un téléchargement.',
  "{name}'s own scripts will no longer run after a download.":
    'Les scripts de {name} ne s’exécuteront plus après un téléchargement.',
  '{name} is going back into the filter, which is rebuilt straight away.':
    '{name} revient dans le filtre, qui est reconstruit immédiatement.',
  '{name} is coming out of the filter, which is rebuilt straight away.':
    '{name} sort du filtre, qui est reconstruit immédiatement.',

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

  // admin overview
  'Users active': 'Membres actifs',
  'Egress this window': 'Sortant sur la période',
  'Over fair use': 'Au-delà de l’usage raisonnable',
  'Service down': 'Service arrêté',
  'service down': 'service arrêté',
  Channels: 'Canaux',
  'Meters run full scale at the busiest channel ({scale}). Loudest first.':
    'Les vumètres sont à pleine échelle sur le canal le plus chargé ({scale}). Le plus chargé en premier.',
  '{amount} GiB': '{amount} Gio',
  '{amount} TiB': '{amount} Tio',
  'Egress {egress}, busiest channel {busiest}':
    'Sortant {egress}, canal le plus chargé {busiest}',
  '{sent} sent · {allowance} GiB allowance': '{sent} envoyés · allocation de {allowance} Gio',
  'Manage users': 'Gérer les membres',
  'within fair use': 'usage raisonnable respecté',
  throttled: 'bridé',
  alerted: 'alerté',
  none: 'aucun',
  'Nothing is blocked: no blocklist is enabled.':
    'Rien n’est bloqué : aucune liste de blocage n’est activée.',
  'Importing the catalog enables the lists MySB used, and downloads them.':
    'Importer le catalogue active les listes qu’utilisait MySB, et les télécharge.',
  'Nothing is blocked yet: the enabled blocklists were never downloaded.':
    'Rien n’est encore bloqué : les listes de blocage activées n’ont jamais été téléchargées.',
  'Download them now': 'Les télécharger maintenant',
  'No monitoring is installed on this box.': 'Aucune supervision n’est installée sur cette box.',
  'KoBox vendors NanoMon from a pinned, checksum-verified release. Nothing is pinned, so the component skipped rather than fetching whatever a URL happened to serve. Set {url} and {checksum}, then run {install}.':
    'KoBox embarque NanoMon depuis une version épinglée, à l’empreinte vérifiée. Rien n’est épinglé, le composant a donc été ignoré plutôt que de récupérer ce qu’une URL aurait servi. Renseignez {url} et {checksum}, puis lancez {install}.',
  'Health tells you the same thing about every component, with the reason each one gave.':
    'État du système vous dit la même chose pour chaque composant, avec la raison donnée par chacun.',
  'Invitation sent': 'Invitation envoyée',
  'Invitation sent to {name}': 'Invitation envoyée à {name}',
  'The mail is on its way. You can also pass the link on yourself; it works once and for 7 days.':
    'Le mail est en route. Vous pouvez aussi transmettre le lien vous-même : il sert une seule fois, pendant 7 jours.',
  'Copy the link': 'Copier le lien',
  'Back to {name}': 'Retour à {name}',

  // admin groups
  'Who reaches the box and how, and what rTorrent talks to.':
    'Qui accède à la box et comment, et avec qui rTorrent parle.',
  'Trusted addresses': 'Adresses de confiance',
  Optional: 'Facultatif',
  "A member's fixed addresses, such as their home connection, trusted on every port of the box and for NFS without the VPN. Without any, everything works: the portal, ruTorrent, Nextcloud, SFTP and the VPN.":
    'Les adresses fixes d’un membre, comme sa connexion à la maison, de confiance sur tous les ports de la box et pour NFS sans le VPN. Sans aucune, tout fonctionne : le portail, ruTorrent, Nextcloud, SFTP et le VPN.',
  'The private trackers allowed, and their certificates.':
    'Les trackers privés autorisés, et leurs certificats.',
  'The address ranges rTorrent refuses to talk to.':
    'Les plages d’adresses avec lesquelles rTorrent refuse de parler.',
  "Each member's upload compared with the others, and the exceptions.":
    'L’envoi de chaque membre comparé à celui des autres, et les exceptions.',
  'What the box needs to run and to reach people.':
    'Ce dont la box a besoin pour tourner et pour joindre les gens.',
  'Invitations, forgotten passwords and alerts leave through it.':
    'Les invitations, les mots de passe oubliés et les alertes partent par lui.',
  'Sent mails': 'Mails envoyés',
  'What the box sent, and what it could not.':
    'Ce que la box a envoyé, et ce qu’elle n’a pas pu envoyer.',
  "The box's public name and its Let's Encrypt certificate.":
    'Le nom public de la box et son certificat Let’s Encrypt.',
  'Debian packages waiting to be installed.': 'Les paquets Debian en attente d’installation.',
  'To understand a problem. Nothing here changes the box.':
    'Pour comprendre un problème. Rien ici ne modifie la box.',
  "A service's latest lines, to read or to hand over for a diagnosis.":
    'Les dernières lignes d’un service, à lire ou à transmettre pour un diagnostic.',
  'Configuration files': 'Fichiers de configuration',
  'What KoBox wrote for nginx, rTorrent, the firewall and the rest, read-only.':
    'Ce que KoBox a écrit pour nginx, rTorrent, le pare-feu et le reste, en lecture seule.',

  // configuration files: each file's title and purpose come from the catalog
  // in domain/installation/ConfigDocument.ts
  Configuration: 'Configuration',
  'Every file KoBox writes onto this box, as it is on disk right now. Read-only, and only these files: this page cannot edit them, and it cannot open anything else. Files holding a secret (the worker environment, the VPN keys) are not listed and cannot be reached from here.':
    'Chaque fichier que KoBox écrit sur cette box, tel qu’il est sur le disque en ce moment. En lecture seule, et seulement ces fichiers : cette page ne peut ni les modifier, ni ouvrir quoi que ce soit d’autre. Les fichiers qui contiennent un secret (l’environnement du worker, les clés VPN) ne sont pas listés et restent inaccessibles d’ici.',
  'What it decides': 'Ce qu’il décide',
  Path: 'Chemin',
  'This file is not on this box.': 'Ce fichier n’est pas sur cette box.',
  'That is normal when the component it belongs to was never installed: no NFS means no exports file. Nothing is wrong.':
    'C’est normal quand le composant auquel il appartient n’a jamais été installé : sans NFS, pas de fichier exports. Rien d’anormal.',
  'Showing the first 256 KB. The rest is on disk.':
    'Seuls les 256 premiers Ko sont affichés. Le reste est sur le disque.',
  Scheduler: 'Planificateur',
  'Which maintenance jobs run, and when. Every line only enqueues a job.':
    'Quelles tâches de maintenance tournent, et quand. Chaque ligne ne fait que mettre une tâche en file.',
  'Web front end': 'Serveur web frontal',
  'How the portal, ruTorrent and the monitoring page are exposed and gated.':
    'Comment le portail, ruTorrent et la page de supervision sont exposés et protégés.',
  'ruTorrent per-user routing': 'Routage ruTorrent par membre',
  'Which SCGI socket each member reaches. Regenerated when accounts change.':
    'Quel socket SCGI chaque membre atteint. Régénéré quand les comptes changent.',
  'Portal service': 'Service du portail',
  'The non-root web process and everything systemd forbids it from touching.':
    'Le processus web non root, et tout ce que systemd lui interdit de toucher.',
  'Worker service': 'Service du worker',
  'The one privileged process: it executes the typed jobs the portal enqueues.':
    'Le seul processus privilégié : il exécute les tâches typées que le portail met en file.',
  'Monitoring service': 'Service de supervision',
  'The metrics collector behind /monitoring, bound to the loopback only.':
    'Le collecteur de métriques derrière /monitoring, lié à la boucle locale uniquement.',
  'Firewall service': 'Service du pare-feu',
  'Reapplies the packet filter at boot, before anything listens.':
    'Réapplique le filtre de paquets au démarrage, avant que quoi que ce soit n’écoute.',
  'Ban rules': 'Règles de bannissement',
  'How many failures, over what window, earn how long a ban.':
    'Combien d’échecs, sur quelle durée, valent un bannissement de combien de temps.',
  'Ban filter: portal logins': 'Filtre de bannissement : connexions au portail',
  'The pattern that recognises a failed portal login in the journal.':
    'Le motif qui reconnaît une connexion ratée au portail dans le journal.',
  'Ban filter: SSH key flooding': 'Filtre de bannissement : rafales de clés SSH',
  'The pattern that recognises a client trying key after key.':
    'Le motif qui reconnaît un client essayant clé après clé.',
  'NFS shares': 'Partages NFS',
  'Which directories are offered over NFS, to which addresses.':
    'Quels répertoires sont partagés en NFS, et vers quelles adresses.',
  'Windows shares': 'Partages Windows',
  'The same directories over SMB, for machines that do not speak NFS.':
    'Les mêmes répertoires en SMB, pour les machines qui ne parlent pas NFS.',
  'Package sources': 'Sources des paquets',
  'Where the system updates on the Updates screen actually come from.':
    'D’où viennent réellement les mises à jour système de l’écran Mises à jour.',
  'Encrypted DNS': 'DNS chiffré',
  'Which resolver the box uses, and how its answers are validated.':
    'Quel résolveur la box utilise, et comment ses réponses sont validées.',
  'Kernel tuning': 'Réglages du noyau',
  'Network buffers and limits sized for many simultaneous transfers.':
    'Tampons réseau et limites dimensionnés pour de nombreux transferts simultanés.',

  // logs and updates
  'never captured': 'jamais capturé',
  'captured {at}': 'capturé le {at}',
  'Capture now': 'Capturer maintenant',
  'Capture to see the last lines this unit wrote.':
    'Capturez pour voir les dernières lignes écrites par cette unité.',
  'The last 200 lines each KoBox unit wrote, captured on demand. Only these units: reading the whole host journal from a web page is not something this portal is allowed to do.':
    'Les 200 dernières lignes écrites par chaque unité KoBox, capturées à la demande. Seulement ces unités : lire tout le journal de la machine depuis une page web n’est pas permis à ce portail.',
  'System updates': 'Mises à jour du système',
  'never checked': 'jamais vérifié',
  'checked {at}': 'vérifié le {at}',
  'Nobody has looked yet.': 'Personne n’a encore regardé.',
  'Everything is up to date.': 'Tout est à jour.',
  '1 package can be updated.': '1 paquet peut être mis à jour.',
  '{count} packages can be updated.': '{count} paquets peuvent être mis à jour.',
  'Check for updates': 'Chercher des mises à jour',
  'Install them': 'Les installer',
  'Installing restarts the daemons that were updated, so transfers can drop for a moment. It never reboots and never removes a package.':
    'L’installation redémarre les démons mis à jour, les transferts peuvent donc couper un instant. Elle ne redémarre jamais la machine et ne retire jamais de paquet.',
  Package: 'Paquet',

  // domain and mail relay
  "Out of the box this machine serves its pages under a certificate it signed itself, which every browser refuses loudly. Give it a public name that points here and it can get a real certificate from Let's Encrypt, renewed on its own from then on.":
    'Au départ, cette machine sert ses pages avec un certificat qu’elle a signé elle-même, que tous les navigateurs refusent bruyamment. Donnez-lui un nom public qui pointe ici et elle pourra obtenir un vrai certificat auprès de Let’s Encrypt, renouvelé tout seul ensuite.',
  'No public name set, so the self-signed certificate stays.':
    'Aucun nom public défini, le certificat auto-signé reste donc en place.',
  'Public name {domain}, certificate notices to {email}.':
    'Nom public {domain}, avis de certificat envoyés à {email}.',
  'Two things have to be true before a certificate can be issued: the name must already resolve to this machine, and someone must run {install} on it. Saving here does neither. The renewal afterwards is automatic and needs nobody.':
    'Deux conditions avant qu’un certificat puisse être émis : le nom doit déjà pointer vers cette machine, et quelqu’un doit y lancer {install}. Enregistrer ici ne fait ni l’un ni l’autre. Le renouvellement est ensuite automatique et ne demande personne.',
  'KoBox sends mail: a temporary password when you create an account, a warning when a torrent is removed, a report when a backup fails. Most providers refuse mail sent straight from a seedbox, so it goes out through a relay you authenticate against.':
    'KoBox envoie des mails : un mot de passe temporaire à la création d’un compte, un avertissement quand un torrent est retiré, un rapport quand une sauvegarde échoue. La plupart des fournisseurs refusent les mails envoyés directement depuis une seedbox, ils partent donc par un relais auprès duquel vous vous authentifiez.',
  'No relay configured yet, so mail stays queued rather than being lost.':
    'Aucun relais configuré pour l’instant, les mails restent donc en file plutôt que d’être perdus.',
  'Currently sending through {relay} as {user}.':
    'Envoi actuellement par {relay} en tant que {user}.',
  "The password is sealed with this box's key before it is stored. It is never shown again, so type it in full each time you change anything here.":
    'Le mot de passe est scellé avec la clé de cette box avant d’être stocké. Il n’est plus jamais affiché : retapez-le en entier à chaque modification ici.',
  'Sends one message to your own address. A relay you have never tested is a relay you find out about on the day it matters.':
    'Envoie un message à votre propre adresse. Un relais jamais testé, on le découvre le jour où il compte.',

  // member addresses and fair use
  'Member addresses': 'Adresses des membres',
  "The portal, ruTorrent, Nextcloud and the VPN are open to all, behind each member's username and password. SSH and SFTP answer only the addresses and hostnames below and the VPN, as soon as one address is declared. Members declare their own addresses and dynamic hostnames in {account}; add one here for them when they ask.":
    'Le portail, ruTorrent, Nextcloud et le VPN sont ouverts à tous, derrière l’identifiant et le mot de passe de chaque membre. SSH et SFTP ne répondent qu’aux adresses et noms d’hôte ci-dessous et au VPN, dès qu’une adresse est déclarée. Les membres déclarent eux-mêmes leurs adresses et noms d’hôte dynamiques dans {account} ; ajoutez-en une ici pour eux quand ils le demandent.',
  "An address listed here is a member's own fixed connection, such as their home, trusted beyond that: the firewall accepts it on every port of the box, ahead of the blocklists; fail2ban never bans it; and their folder is shared to it over NFS without the VPN. List only an address you trust that much.":
    'Une adresse listée ici est la connexion fixe d’un membre, comme celle de chez lui, et elle a droit à plus de confiance : le pare-feu l’accepte sur tous les ports de la box, avant les listes de blocage ; fail2ban ne la bannit jamais ; et son dossier lui est partagé en NFS sans le VPN. N’ajoutez qu’une adresse en laquelle vous avez autant confiance.',
  'Use a {dyndns} when their home address changes, which it usually does. KoBox re-resolves it on a schedule and follows it without anyone touching the firewall; the last resolved address is shown so you can tell a stale entry from a live one.':
    'Utilisez un {dyndns} quand leur adresse à la maison change, ce qui est en général le cas. KoBox le résout à nouveau régulièrement et le suit sans que personne ne touche au pare-feu ; la dernière adresse résolue est affichée pour distinguer une entrée périmée d’une entrée à jour.',
  'DynDNS hostname': 'nom d’hôte DynDNS',
  'DynDNS hostnames': 'Noms d’hôte DynDNS',
  User: 'Membre',
  'Add address': 'Ajouter l’adresse',
  'Add hostname': 'Ajouter le nom d’hôte',
  'Last resolved': 'Dernière résolution',
  unresolved: 'non résolu',
  When: 'Quand',
  Event: 'Événement',
  'One member saturating the link makes the box unusable for everyone else. KoBox samples what each one actually moves and answers in steps rather than cutting them off: {none} is the normal state, {alerted} means they have been told, {throttled} means their bandwidth is capped until they come back under. Nothing here deletes anything or suspends an account.':
    'Un membre qui sature le lien rend la box inutilisable pour tous les autres. KoBox mesure ce que chacun fait réellement passer et répond par paliers plutôt que de couper : {none} est l’état normal, {alerted} veut dire qu’il a été prévenu, {throttled} que sa bande passante est plafonnée jusqu’à ce qu’il repasse en dessous. Rien ici ne supprime quoi que ce soit ni ne suspend un compte.',
  'Every decision is recorded below, and every one is reversible: a {override} raises the limit for a member who has a reason, without changing it for anyone else.':
    'Chaque décision est consignée ci-dessous, et chacune est réversible : une {override} relève la limite pour un membre qui a une raison, sans la changer pour les autres.',
  'budget override': 'dérogation de budget',
  'Budget override': 'Dérogation de budget',
  Level: 'Niveau',
  Egress: 'Sortant',
  Ingress: 'Entrant',
  Sampled: 'Mesuré',
  'Sustained egress (Mbit/s, empty = keep, "clear" = default)':
    'Débit sortant soutenu (Mbit/s, vide = garder, « clear » = par défaut)',
  'SSH auths per hour (empty = keep, "clear" = default)':
    'Authentifications SSH par heure (vide = garder, « clear » = par défaut)',
  'Throttle target (Mbit/s, empty = keep, "clear" = default)':
    'Débit une fois bridé (Mbit/s, vide = garder, « clear » = par défaut)',
  'Apply override': 'Appliquer la dérogation',
  'Recent events': 'Événements récents',

  // health and mails
  healthy: 'opérationnel',
  unhealthy: 'en panne',
  installed: 'installé',
  skipped: 'ignoré',
  'Monitoring of the machine: CPU, memory, network, disks':
    'Supervision de la machine : CPU, mémoire, réseau, disques',
  'Service probes': 'Sondes des services',
  Probe: 'Sonde',
  'Managed services': 'Services gérés',
  'The worker itself is not here on purpose: it is what carries out the restart, so restarting it from this page would kill the job mid-flight.':
    'Le worker lui-même n’est pas là, exprès : c’est lui qui exécute le redémarrage, le redémarrer depuis cette page tuerait la tâche en cours de route.',
  Unit: 'Unité',
  Restart: 'Redémarrer',
  'Link speed': 'Débit du lien',
  'Measure now': 'Mesurer maintenant',
  'Saturates the connection for about ten seconds, so downloads slow down while it runs, and a measurement taken while the box is busy reads low. Nothing schedules it.':
    'Sature la connexion pendant une dizaine de secondes : les téléchargements ralentissent pendant la mesure, et une mesure prise pendant que la box est occupée sort trop basse. Rien ne la planifie.',
  'No measurement binary pinned. Set {url} and {checksum}, then run {install}.':
    'Aucun binaire de mesure épinglé. Renseignez {url} et {checksum}, puis lancez {install}.',
  'No measurement yet.': 'Aucune mesure pour l’instant.',
  Down: 'Descendant',
  Up: 'Montant',
  Latency: 'Latence',
  Server: 'Serveur',
  Measured: 'Mesuré',
  Components: 'Composants',
  Component: 'Composant',
  Version: 'Version',
  Reason: 'Raison',
  Releases: 'Versions déployées',
  Ref: 'Réf.',
  Created: 'Création',
  Switched: 'Bascule',
  sent: 'envoyé',
  'Mail outbox': 'Mails sortants',
  Recipient: 'Destinataire',
  Subject: 'Objet',
  Attempts: 'Tentatives',
  'Last error': 'Dernière erreur',

  // trackers and blocklists
  dead: 'mort',
  plain: 'en clair',
  'Fetch cert': 'Récupérer le certificat',
  'Mark dead': 'Marquer comme mort',
  'The trackers KoBox knows about, discovered from the torrents members actually add. A {private} is one that expects an account; a {public} is open to anyone. Members can be refused public trackers individually, from their own page under Members.':
    'Les trackers que KoBox connaît, découverts dans les torrents que les membres ajoutent réellement. Un {private} demande un compte ; un {public} est ouvert à tous. Les trackers publics peuvent être refusés membre par membre, depuis sa propre page dans Membres.',
  'private tracker': 'tracker privé',
  'public tracker': 'tracker public',
  'KoBox watches the certificate of each https tracker and warns before it expires, because an expired one stops announcing and torrents go quiet without saying why. {renew} re-checks them all now instead of waiting for the nightly pass. A tracker marked {dead} is kept but no longer checked.':
    'KoBox surveille le certificat de chaque tracker https et prévient avant son expiration, car un certificat expiré n’annonce plus et les torrents se taisent sans dire pourquoi. {renew} les revérifie tous maintenant au lieu d’attendre le passage de la nuit. Un tracker marqué {dead} est conservé mais n’est plus vérifié.',
  Endpoint: 'Point d’accès',
  'Cert expiry': 'Expiration du certificat',
  Actions: 'Actions',
  "Lists of IP ranges that never get to talk to your members' torrent clients: anti-piracy monitors, known bad actors, advertising networks. Each list is published by someone else and fetched by KoBox; the merged ranges go into the kernel's packet filter, so blocking costs nothing at transfer time.":
    'Des listes de plages IP qui ne peuvent jamais parler aux clients torrent de vos membres : sociétés de surveillance anti-piratage, acteurs malveillants connus, régies publicitaires. Chaque liste est publiée par quelqu’un d’autre et récupérée par KoBox ; les plages fusionnées vont dans le filtre de paquets du noyau, si bien que le blocage ne coûte rien pendant les transferts.',
  '{enabled} is what decides whether a list counts: a disabled one stays here for later and is not fetched. {update} re-downloads every enabled list instead of waiting for the scheduled pass, and {import} adds the well-known public lists so you can pick from them rather than typing URLs.':
    '{enabled} décide si une liste compte : une liste désactivée reste ici pour plus tard et n’est pas récupérée. {update} retélécharge toutes les listes activées sans attendre le passage planifié, et {import} ajoute les listes publiques connues pour que vous puissiez choisir parmi elles plutôt que de taper des URL.',
  'Import catalog': 'Importer le catalogue',
  'None of this is a guarantee, and it is not a substitute for the VPN under Account. It removes the loudest, best-known watchers.':
    'Rien de tout cela n’est une garantie, et cela ne remplace pas le VPN de Mon compte. Cela écarte les surveillants les plus bruyants et les plus connus.',

  // one member
  'User {name}': 'Membre {name}',
  'Email: {email}': 'Adresse mail : {email}',
  'Quota: {quota} GiB': 'Quota : {quota} Gio',
  'SCGI port: {port}': 'Port SCGI : {port}',
  'rTorrent port: {port}': 'Port rTorrent : {port}',
  '{name} can currently add torrents from {which}.':
    '{name} peut actuellement ajouter des torrents depuis {which}.',
  'any tracker, public ones included': 'n’importe quel tracker, publics compris',
  'private trackers only': 'les trackers privés uniquement',
  "Scripts in {path} currently {state} when one of {name}'s downloads finishes.":
    'Les scripts de {path} {state} actuellement quand un téléchargement de {name} se termine.',
  run: 's’exécutent',
  'do not run': 'ne s’exécutent pas',

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
  'storage.using': 'Utilise {used} sur {allowance}',
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
  'storage.using': 'Using {used} of {allowance}',
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

// Every sentence the French catalogue holds, so a test can tell a line that
// no page sends any more from one still in use.
export function frenchSentences(): readonly string[] {
  return Object.keys(FR);
}

export function translatorFor(language: Language): Translate {
  const catalogue = CATALOGUES[language.value];
  return (english, values) => fill(catalogue?.[english] ?? english, values);
}
