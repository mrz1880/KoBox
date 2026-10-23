# KoBox : développement local

Le code neuf vit dans **`kobox/`** (TypeScript strict, architecture hexagonale). Le reste du
repo est le legacy MySB : **on n'y touche pas**. KoBox le remplace morceau par morceau, sans le
modifier.

## Prérequis

- Node ≥ 24 + pnpm (`corepack enable pnpm`)
- Docker Desktop (tests d'intégration système et E2E Debian 13)

## Boucle rapide (sur le Mac, sans Docker)

```bash
cd kobox
pnpm install
pnpm test        # unit + component + contract (< 5 s)
pnpm test:int    # intégration SQLite réelle (les tests système se skippent hors linux/root)
pnpm lint && pnpm typecheck
```

Le domaine, l'application et le portail se testent avec des **fakes** : aucune commande système
n'est exécutée par ces suites. Le portail se pilote par `.inject()` Fastify avec un jar cookie et
le jeton CSRF (`test/component/interfaces/portalWorld.ts`).

## Mutation testing (Stryker)

La couverture ligne (`pnpm coverage`, seuil 85 %) dit *ce qui est exécuté* ; le mutation testing
dit *ce qui est réellement asserté*. Stryker mute `src/domain/**` + `src/application/**` et
rejoue les suites unit/component/contract (`vitest.mutation.config.ts`) ; le checker TypeScript
écarte les mutants qui ne compilent pas.

```bash
cd kobox
pnpm mutation                                         # domaine + application (lent)
pnpm exec stryker run --mutate "src/domain/user/**"   # un sous-arbre (itération rapide)
```

Rapport HTML : `reports/mutation/index.html`. Le seuil de rupture (`thresholds.break` dans
`stryker.conf.json`) fait échouer la commande sous ce score : remonte-le quand les tests
s'améliorent. La plupart des survivants sont des mutants de faible valeur (littéraux de messages
d'erreur, bornes de regex des value objects). C'est un outil **à la demande**, trop lourd pour la
CI et le hook pre-push : à jouer avant un refactor ou pour blinder un module.

## Conteneur Debian 13 (adapters réels + E2E)

```bash
cd kobox
make up        # build + boot du conteneur systemd privilégié (debian:13) et de pebble
make install   # dépendances pnpm dans le conteneur
make test-int  # adapters système contre useradd/usermod/gpasswd réels
make e2e       # build puis toutes les suites test/e2e
make shell     # shell dans le conteneur (repo monté sur /opt/KoBox)
make down      # détruit conteneurs + volumes
make e2e-full  # tout depuis zéro comme la CI (up, install, test-int, e2e), puis down -v même en échec
```

L'E2E de la CI ne tourne que sur les pull requests : joue-le en local avant de pousser.

- Le repo est monté dans le conteneur ; `kobox/node_modules` est masqué par un volume (les
  modules natifs macOS et linux ne sont pas interchangeables).
- La DB vit dans `/var/lib/kobox/kobox.db` (`KOBOX_DB` pour la déplacer).
- **Quotas** : les filesystems du conteneur (overlay, tmpfs) ne supportent pas les quotas ext4.
  Sans `KOBOX_QUOTA_FS`, l'adapter Noop trace un warning explicite et le quota reste enregistré
  en DB. La validation réelle se fait sur VM (voir plus bas).
- `docker/e2e-setup.sh` prépare le conteneur : sshd (chroot `Match Group kobox-sftp`, et la sonde
  anti-verrouillage du pare-feu en a besoin), entrées `/etc/hosts` des fixtures.
- Le worker systemd du conteneur draine les jobs pendant l'E2E : pour observer des jobs
  `pending`, stoppe `kobox-worker` d'abord.

### Aucun réseau sortant, sauf apt

Les suites hébergent leurs fixtures **en local**, sur `127.0.0.2` via `/etc/hosts` (pas `.1` :
le domaine refuse les IP loopback, comme le legacy) :

| Fixture | Adresse | Sert à |
|---|---|---|
| tracker TLS | `tracker.example.org:8443` | certificats de tracker |
| listes HTTPS | `lists.example.net:8444` | catalogue et listes de blocage |
| archive ruTorrent | `lists.example.net:8446` | composant `rutorrent` épinglé |
| ntfy | `ntfy.example.net` | canal d'alerte |
| pebble (ACME) | `https://pebble:14000/dir` | Let's Encrypt, `PEBBLE_VA_ALWAYS_VALID=1` |

Seul apt parle aux vrais miroirs Debian (E2E d'installation). certbot ne contacte **jamais** le
vrai Let's Encrypt : la CA de test de pebble est partagée par le volume `pebble_test`, montée
sous `/opt/pebble-test`. `NODE_EXTRA_CA_CERTS` fait accepter les fixtures auto-signées.

> Dans un test qui héberge une fixture, lance worker et CLI enfants en **asynchrone**
> (`execFile` promisifié) : un `execFileSync` bloque la boucle d'événements et gèle les
> handshakes TLS de la fixture.

### Ce que chaque suite système suppose

- **Pare-feu et tc** : les suites qui les mutent sont doublement gardées (root + `/.dockerenv`),
  elles ne s'exécutent jamais sur un hôte Linux nu. L'apply passe par le garde
  anti-verrouillage (`iptables-restore`, sonde SSH sur `KOBOX_SSH_PORT`, rollback).
- **fail2ban** n'est validé que par `fail2ban-client -t` : aucun ban pendant les suites. L'E2E
  d'installation l'active puis le redésactive en `afterAll`.
- **Journal** : l'E2E sécurité inonde le journal via `systemd-cat -t sshd` ; l'adapter journald
  matche l'identifier, pas l'unité, exactement pour ça.
- **Installation** (`test/e2e/installation.e2e.test.ts`) rejoue `bootstrap/install.sh`.
  `kobox install` tourne en direct root, sans la queue (le worker n'existe pas encore), puis
  draine les jobs de rendu. Les `KOBOX_*` du moment de l'install sont figés dans
  `/etc/kobox/worker.env` (0600) pour `kobox-worker.service`. L'installeur n'édite jamais fstab :
  il active les quotas seulement si `usrquota` est déjà monté. `kobox uninstall --yes` retire les
  unités et fichiers KoBox sans toucher `/home`, la DB ni les paquets.
- **Blocklist** : ipset applique les listes. Sur un noyau Docker sans `ip_set`, le composant se
  déclare `skipped` et seul le filtre rtorrent s'applique.
- **Upgrades** : les tests git créent leurs propres dépôts scratch (`file://`), le checkout monté
  n'est jamais muté. L'E2E upgrade bascule `/opt/kobox/current` vers des releases factices puis
  restaure le lien en `afterAll`.
- **Portail** (`test/e2e/portal-access.e2e.test.ts`) : `kobox-portal` tourne non-root sur
  `127.0.0.1:8190` derrière nginx (`:8189`), qui lui délègue `/ru`, `/RPC-<USER>` et `/shell`
  par `auth_request`. La suite crée le groupe `kobox-portal`, fournit une PKI fixture (easy-rsa
  absent du conteneur : l'émission réelle des certificats VPN relève de l'E2E sécurité), lance le
  portail en process enfant et renvoie à la main le cookie `Secure` sur 127.0.0.1.
- **DB partagée** : `/var/lib/kobox` est `2770 root:kobox-portal` (setgid) et les unités worker et
  portail tournent en `UMask=0007`, pour que les fichiers WAL et `-shm` de SQLite restent
  accessibles en écriture au groupe : le portail non-root ouvre la même base que le worker root.

### Variables d'environnement utiles

| Domaine | Variables |
|---|---|
| Chemins | `KOBOX_DB`, `KOBOX_SPOOL` (événements rtorrent, défaut `/var/spool/kobox/events`), `KOBOX_BIN` (commande insérée dans les shims, défaut `/usr/local/bin/kobox`), `KOBOX_INSTALL_DIR` |
| Installation | `KOBOX_STRICT_SERVICES=1` (unité absente = erreur), `KOBOX_QUOTA_FS`, `KOBOX_RUTORRENT_URL` + `KOBOX_RUTORRENT_SHA256` (sans pin, le composant est `skipped`) |
| Trackers, listes | `KOBOX_IBLOCKLIST_CATALOG_URL`, `KOBOX_BLOCKLIST_CACHE`, `KOBOX_CERTS_DIR` (défaut `/etc/ssl/certs`), `KOBOX_IBLOCKLIST_USER` + `KOBOX_IBLOCKLIST_PIN` (jamais en DB ni dans les logs) |
| Réseau, VPN | `KOBOX_SSH_PORT` (défaut 22), `KOBOX_PORTAL_PORT`, `KOBOX_VPN_{TUN_GW,TUN,TAP}_PORT`, `KOBOX_VPN_*_SUBNET`, `KOBOX_VPN_REMOTE`, `KOBOX_VPN_PKI` (défaut `/etc/openvpn/kobox-pki`), `KOBOX_VPN_PROFILES_DIR` (défaut `/etc/kobox/vpn-profiles`), `KOBOX_WAN_IF` (défaut `eth0`), `KOBOX_FAIRUSE_{EGRESS_MBIT,AUTH_PER_HOUR,THROTTLE_MBIT}` (défauts 50/30/5) |
| Alertes | `KOBOX_NTFY_URL`, `KOBOX_DISCORD_WEBHOOK`, `KOBOX_ALERT_EMAIL` (aucun = stub console) |
| Let's Encrypt | `KOBOX_LE_DOMAIN` + `KOBOX_LE_EMAIL` (arment le composant), `KOBOX_ACME_URL`, `KOBOX_ACME_CA_BUNDLE` |
| Sauvegardes, upgrades | `KOBOX_BACKUP_ROOT`, `KOBOX_BACKUP_TTL_DAYS`, `KOBOX_BACKUP_KEEP_MIN`, `KOBOX_REPO_DIR`, `KOBOX_RELEASES_DIR`, `KOBOX_CURRENT_LINK` |
| Portail | `KOBOX_PORTAL_HTTP_PORT`, `KOBOX_PORTAL_HTTP_HOST` |

## VM Multipass (quotas ext4 réels)

Le conteneur couvre tout sauf les quotas. Pour eux, une VM jetable :

```bash
brew install --cask multipass
multipass launch --name kobox-test --cpus 4 --memory 8G --disk 30G 24.04
multipass mount ~/Project/KoBox kobox-test:/opt/KoBox
multipass shell kobox-test
# dans la VM : installer node 24, puis KOBOX_QUOTA_FS=/ pnpm test:int
```

## Garde-fous

1. **Jamais** de test contre une seedbox en production : tout se joue dans le conteneur ou une VM
   jetable.
2. Le legacy (`install/ web/ inc/ bin/ scripts/ templates/ upgrade/`) est en lecture seule.
3. `pnpm lint` interdit `any` ; le domaine n'importe ni Drizzle, ni pino, ni `node:*`.

## Publier une version

Une version est un tag `vX.Y.Z` posé sur un commit de `main` : une box le déploie depuis les
sources (`kobox upgrade --to vX.Y.Z`, cf. `docs/OPS.md`), il n'y a aucun artefact à builder.

```bash
git fetch && git switch main && git pull
git tag -a v1.2.0 -m "KoBox v1.2.0"
git push origin v1.2.0
```

- Le hook `pre-push` refuse le tag si son commit n'est pas sur `origin/main`, ou si aucun run
  `kobox-ci` vert n'a testé le même code `kobox/` (un merge dont la CI tourne encore est refusé :
  attendre le vert, puis repousser). Il lit les runs via `gh`, qui doit être authentifié.
- Le workflow `kobox-release` crée alors la GitHub Release, avec les notes générées depuis le tag
  `v*` précédent (jamais depuis un `archive/*` hérité de MySB).
