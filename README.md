# KoBox

[English](#english) · [Français](#français)

## English

KoBox is a multi-user seedbox for a dedicated server running Debian 13 (trixie). Each member
gets their own rTorrent, their own disk quota and their own way in; the administrator runs the
whole box from a web console and a single command-line tool.

KoBox started as a fork of [MySB](https://github.com/toulousain79/MySB) and replaces it piece by
piece. Its security stance is the same: incoming peers are filtered through IP blocklists and a
tracker whitelist, and outgoing DNS queries leave the box encrypted. What changed is how the box
is driven: the bash scripts gave way to a tested TypeScript application, where a root worker is
the only process allowed to touch the system and the web portal holds no privilege at all.

### What a box offers

- **Torrents**: one rTorrent per member, with ruTorrent, a watch folder and a disk quota.
- **Filtering**: tracker whitelist, IP blocklists enforced by ipset, firewall, fail2ban.
- **Privacy**: DNS resolved locally by bind and forwarded through dnscrypt-proxy; an OpenVPN
  profile per member.
- **Getting files in and out**: direct downloads through a debrid account (AllDebrid + aria2),
  Nextcloud (drop a `.torrent` in the Watch folder), Samba, and automatic sending of finished
  downloads to a member's own machine.
- **Web portal**: a console for members and administrators, with a media browser, monitoring
  (NanoMon), a link speed test and a browser shell.
- **Running it**: scheduled jobs, backups and restore, upgrades by version tag with rollback,
  Let's Encrypt certificates, mail through a relay.

### Install

You need a dedicated server freshly installed with **Debian 13**, and root access. The bootstrap
script installs Node.js, fetches the sources, builds them and hands over to `kobox install`:

```sh
curl -fsSL https://raw.githubusercontent.com/<owner>/KoBox/main/kobox/bootstrap/install.sh \
  | KOBOX_REPO=https://github.com/<owner>/KoBox.git bash
```

Replace `<owner>` with the account hosting the repository you install from. Some components
(ruTorrent, Nextcloud, NanoMon, the speed test) only install from a release you pin and verify:
without a pin they report `skipped` and say what is missing. `docs/OPS.md` gives each pin. Set
them, run `kobox install` again, and check the result:

```sh
kobox install-status
kobox doctor
```

Invite the first administrator. The command prints the invitation link, valid 7 days and once:
open it to choose the password, even before the box can send mail.

```sh
kobox invite-member alice --email alice@example.org --admin
```

The portal answers on `https://<your-host>:8189`.

### Upgrade

Each version is a `vX.Y.Z` tag, listed on the repository's Releases page with its notes. A box
deploys it from the sources and keeps the previous release to roll back to:

```sh
kobox upgrade --to vX.Y.Z
kobox upgrade --rollback
```

### Documentation

| Document | For | Language |
| --- | --- | --- |
| [`docs/OPS.md`](docs/OPS.md) | Running an installed box: pins, backups, upgrades, mail, DNS, portal | English |
| [`docs/DEV.md`](docs/DEV.md) | Working on the code: tests, Debian 13 container, releasing | French |
| [`docs/CUTOVER.md`](docs/CUTOVER.md) | Moving the members of a MySB box to a new KoBox server | English |

### Repository layout

KoBox lives in [`kobox/`](kobox): domain, use cases, adapters, CLI, worker and portal, with
their tests. Everything else at the root is the MySB code inherited from the fork, kept read-only
while KoBox replaces it. KoBox still reads the rTorrent templates in `templates/rtorrent/`.

To start working on it: `cd kobox && pnpm install && pnpm test`, then see `docs/DEV.md`.

### Licence

MIT, see [`LICENCE.md`](LICENCE.md). KoBox owes its starting point to MySB by toulousain79.

## Français

KoBox est une seedbox multi-utilisateurs pour un serveur dédié sous Debian 13 (trixie). Chaque
membre a son propre rTorrent, son propre quota disque et ses propres accès ; l'administrateur
pilote toute la box depuis une console web et un unique outil en ligne de commande.

KoBox est né d'un fork de [MySB](https://github.com/toulousain79/MySB) et le remplace morceau
par morceau. La philosophie de sécurité reste la même : les pairs entrants passent par des listes
de blocage d'IP et une liste blanche de trackers, et les requêtes DNS sortantes quittent la box
chiffrées. Ce qui change, c'est la façon de piloter la box : les scripts bash ont laissé la place
à une application TypeScript testée, où un worker root est le seul processus autorisé à toucher
au système et où le portail web ne détient aucun privilège.

### Ce que propose une box

- **Torrents** : un rTorrent par membre, avec ruTorrent, un dossier de surveillance et un quota
  disque.
- **Filtrage** : liste blanche de trackers, listes de blocage d'IP appliquées par ipset, pare-feu,
  fail2ban.
- **Confidentialité** : DNS résolu localement par bind et relayé par dnscrypt-proxy ; un profil
  OpenVPN par membre.
- **Faire entrer et sortir les fichiers** : téléchargement direct via un compte de débridage
  (AllDebrid + aria2), Nextcloud (déposer un `.torrent` dans le dossier Watch), Samba, et envoi
  automatique des téléchargements terminés vers la machine du membre.
- **Portail web** : une console pour les membres et les administrateurs, avec un navigateur de
  médias, la supervision (NanoMon), un test de débit du lien et un shell dans le navigateur.
- **Exploitation** : tâches planifiées, sauvegardes et restauration, mises à jour par tag de
  version avec retour arrière, certificats Let's Encrypt, mails via un relais.

### Installer

Il faut un serveur dédié fraîchement installé en **Debian 13**, et un accès root. Le script
d'amorçage installe Node.js, récupère les sources, les compile puis passe la main à
`kobox install` :

```sh
curl -fsSL https://raw.githubusercontent.com/<owner>/KoBox/main/kobox/bootstrap/install.sh \
  | KOBOX_REPO=https://github.com/<owner>/KoBox.git bash
```

Remplace `<owner>` par le compte qui héberge le dépôt depuis lequel tu installes. Certains
composants (ruTorrent, Nextcloud, NanoMon, le test de débit) ne s'installent que depuis une
version épinglée et vérifiée : sans épinglage, ils se déclarent `skipped` et disent ce qui manque.
`docs/OPS.md` donne chaque épinglage. Renseigne-les, relance `kobox install`, puis vérifie :

```sh
kobox install-status
kobox doctor
```

Invite le premier administrateur. La commande affiche le lien d'invitation, valable 7 jours et une
seule fois : ouvre-le pour choisir le mot de passe, même avant que la box sache envoyer des mails.

```sh
kobox invite-member alice --email alice@example.org --admin
```

Le portail répond sur `https://<ton-hôte>:8189`.

### Mettre à jour

Chaque version est un tag `vX.Y.Z`, publié avec ses notes dans la page Releases du dépôt. Une box
la déploie depuis les sources et garde la version précédente pour revenir en arrière :

```sh
kobox upgrade --to vX.Y.Z
kobox upgrade --rollback
```

### Documentation

| Document | Pour | Langue |
| --- | --- | --- |
| [`docs/OPS.md`](docs/OPS.md) | Exploiter une box installée : épinglages, sauvegardes, mises à jour, mail, DNS, portail | anglais |
| [`docs/DEV.md`](docs/DEV.md) | Travailler sur le code : tests, conteneur Debian 13, publication | français |
| [`docs/CUTOVER.md`](docs/CUTOVER.md) | Faire passer les membres d'une box MySB sur un nouveau serveur KoBox | anglais |

### Organisation du dépôt

KoBox vit dans [`kobox/`](kobox) : domaine, cas d'usage, adaptateurs, CLI, worker et portail,
avec leurs tests. Tout le reste à la racine est le code MySB hérité du fork, laissé en lecture
seule pendant que KoBox le remplace. KoBox lit encore les modèles rTorrent de
`templates/rtorrent/`.

Pour s'y mettre : `cd kobox && pnpm install && pnpm test`, puis voir `docs/DEV.md`.

### Licence

MIT, voir [`LICENCE.md`](LICENCE.md). KoBox doit son point de départ à MySB, de toulousain79.
