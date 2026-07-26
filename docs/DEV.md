# KoBox — développement local

Le code neuf vit dans **`kobox/`** (TypeScript strict, archi hexagonale). Le reste du repo
est le legacy MySB : **on n'y touche pas** (stratégie strangler, cf. `docs/AUDIT.md §6`).

## Prérequis

- Node ≥ 24 + pnpm (`corepack enable pnpm`)
- Docker Desktop (pour les tests d'intégration système et l'E2E Debian 12)

## Boucle rapide (sur le Mac, sans Docker)

```bash
cd kobox
pnpm install
pnpm test        # unit + component + contract (< 5 s)
pnpm test:int    # intégration SQLite réelle (les tests système Debian se skippent hors linux/root)
pnpm lint && pnpm typecheck
```

Tout le domaine et l'application se testent avec des **fakes** — aucune commande système
n'est exécutée par ces suites.

## Mutation testing (Stryker)

La couverture ligne (`pnpm coverage`, seuil 85 %) dit *ce qui est exécuté* ; le mutation
testing dit *ce qui est réellement asserté*. Stryker mute `src/domain/**` + `src/application/**`
et rejoue les suites unit/component/contract (`vitest.mutation.config.ts`) ; le checker
TypeScript écarte les mutants qui ne compilent pas.

```bash
cd kobox
pnpm mutation                                   # tout le domaine + application (lent, on-demand)
pnpm exec stryker run --mutate "src/domain/user/**"   # un sous-arbre (itération rapide)
```

Rapport HTML : `reports/mutation/index.html`. Le **seuil de rupture** (`thresholds.break`,
`stryker.conf.json`) fait échouer la commande sous ce score. **Baseline 2026-07-26 : 74,53 %**
(4481 mutants, ~8 min) → `break` calé à **74**. Remonte-le au fur et à mesure que les tests
s'améliorent. La plupart des survivants restants sont des mutants de **faible valeur** (littéraux
de messages d'erreur, bornes de regex des VOs) — on peut soit blinder un fichier ciblé, soit
désactiver le mutateur `StringLiteral` pour réduire le bruit. C'est un outil **on-demand** (trop
lourd pour la CI GitHub Free / le hook pre-push) : à jouer avant un refactor ou pour blinder un module.

## Conteneur Debian 12 (adapters réels + E2E)

```bash
cd kobox
make up        # build + boot du conteneur systemd privilégié (jrei/systemd-debian:12)
make test-int  # adapters système contre useradd/usermod/gpasswd réels
make e2e       # cycle complet CLI -> worker root -> OS (create/suspend/resume/delete)
make shell     # shell dans le conteneur (repo monté sur /opt/KoBox)
make down      # détruit conteneur + volumes
```

Notes :

- Le repo est monté dans le conteneur ; `kobox/node_modules` est masqué par un volume
  (les modules natifs macOS/linux ne sont pas interchangeables).
- La DB vit dans `/var/lib/kobox/kobox.db` (`KOBOX_DB` pour la déplacer).
- **Quota** : les filesystems du conteneur (overlay/tmpfs) ne supportent pas les quotas
  ext4. Sans `KOBOX_QUOTA_FS`, l'adapter Noop trace un warning explicite et le quota
  reste enregistré en DB. La validation quota réelle se fait sur VM (voir plus bas).
- `docker/e2e-setup.sh` prépare le conteneur : conf sshd chroot (`Match Group
  kobox-sftp`). Depuis la Phase 1, l'unité `rtorrent-<user>` est provisionnée par KoBox
  lui-même (image avec le paquet `rtorrent` — l'E2E fait tourner un vrai rtorrent sur la
  config rendue).
- **Événements rtorrent** : les shims écrivent dans le spool `KOBOX_SPOOL`
  (défaut `/var/spool/kobox/events`, mode `1733`) ; le worker root en déduit l'identité
  depuis le propriétaire du fichier. `KOBOX_BIN` fixe la commande `kobox` insérée dans
  les shims rendus (défaut `/usr/local/bin/kobox`).
- **Tracker & Blocklist (Phase 2)** : l'E2E héberge ses fixtures **en local** (aucun
  réseau sortant) — un serveur TLS `tracker.example.org:8443` et un serveur HTTPS
  `lists.example.net:8444`, tous deux sur `127.0.0.2` via `/etc/hosts` (posé par
  `docker/e2e-setup.sh` ; pas `.1` : le domaine filtre les IP loopback comme le legacy).
  Env utiles : `KOBOX_IBLOCKLIST_CATALOG_URL` (catalogue XML), `KOBOX_BLOCKLIST_CACHE`
  (liste fusionnée), `KOBOX_CERTS_DIR` (défaut `/etc/ssl/certs`),
  `KOBOX_IBLOCKLIST_USER`/`KOBOX_IBLOCKLIST_PIN` (abonnement, jamais en DB/logs),
  `NODE_EXTRA_CA_CERTS` (CA de test pour les fixtures auto-signées).
  ⚠️ Dans un test qui héberge un serveur fixture, lancer worker/CLI enfants en
  **asynchrone** (`execFile` promisifié) : un `execFileSync` bloque la boucle
  d'événements et gèle les handshakes TLS des fixtures.

- **Security & Network (Phase 3)** : les suites qui mutent le pare-feu/tc sont
  **double-gardées** (root + `/.dockerenv`) — elles ne s'exécutent jamais sur un hôte
  Linux nu. L'apply passe par le garde anti-verrouillage (`iptables-restore` +
  sonde SSH + rollback) ; la sonde vise `KOBOX_SSH_PORT` (défaut 22 — `ssh` doit
  tourner dans le conteneur, `docker/e2e-setup.sh` s'en charge côté E2E).
  Env utiles : `KOBOX_SSH_PORT`, `KOBOX_PORTAL_PORT`, `KOBOX_VPN_{TUN_GW,TUN,TAP}_PORT`,
  `KOBOX_VPN_*_SUBNET`, `KOBOX_VPN_REMOTE` (nom public des profils client),
  `KOBOX_VPN_PKI` (arbre easy-rsa, défaut `/etc/openvpn/kobox-pki`),
  `KOBOX_WAN_IF` (interface tc/HTB, défaut `eth0`),
  `KOBOX_FAIRUSE_{EGRESS_MBIT,AUTH_PER_HOUR,THROTTLE_MBIT}` (défauts 50/30/5),
  et les canaux d'alerte `KOBOX_NTFY_URL`, `KOBOX_DISCORD_WEBHOOK`,
  `KOBOX_ALERT_EMAIL` (aucun configuré = stub console).
  L'E2E security héberge sa fixture ntfy **en local** (`ntfy.example.net` →
  127.0.0.2 via `/etc/hosts`) et flood le journal via `systemd-cat -t sshd`
  (l'adapter journald matche l'identifier, pas l'unité, exactement pour ça).
  fail2ban n'est validé que par `fail2ban-client -t` — le service reste coupé
  dans le conteneur pour qu'aucun ban ne perturbe les tests.

- **Installation & Provisioning (Phase 4)** : `kobox install` s'exécute **en direct root**
  (pas via la queue — le worker systemd n'existe pas encore) puis fait converger l'état
  désiré en drainant les jobs de rendu des Phases 1-3. L'E2E d'install
  (`test/e2e/installation.e2e.test.ts`) rejoue `bootstrap/install.sh` dans le conteneur :
  apt parle aux vrais miroirs Debian (seul réseau sortant sanctionné) ; l'archive ruTorrent
  vient d'une **fixture https locale** (`lists.example.net:8446` sur 127.0.0.2) — pin via
  `KOBOX_RUTORRENT_URL`/`KOBOX_RUTORRENT_SHA256` (pas de défaut embarqué : sans pin le
  composant est `skipped` avec guidance). Env utiles : `KOBOX_STRICT_SERVICES=1` (unité
  absente = erreur, sauf `pgl`, honnêtement `skipped` sur Debian 12 — remplacement ipset à
  trancher en Phase 5), `KOBOX_INSTALL_DIR`, `KOBOX_QUOTA_FS` (l'installeur n'édite JAMAIS
  fstab : il active les quotas seulement si `usrquota` est déjà monté, sinon il imprime la
  marche à suivre). Le snapshot des `KOBOX_*` du moment de l'install est rendu dans
  `/etc/kobox/worker.env` (0600) pour que `kobox-worker.service` tourne avec la même
  configuration. La PKI OpenVPN est **EC** (easy-rsa `EASYRSA_ALGO=ec`, `dh none`) ;
  `create-user`/`delete-user` chaînent l'émission/suppression du matériel client (le
  `.ovpn` embarque la clé : il ne survit pas à l'utilisateur). `kobox uninstall --yes` est
  l'anti-CleanAll : désactive les unités, retire les fichiers KoBox, ne touche ni
  `/home`, ni la DB, ni les paquets. ⚠️ L'E2E d'install active fail2ban puis le
  redésactive en afterAll (règle Phase 3 : jamais de bans pendant les suites).

- **Maintenance & Ops (Phase 5)** : `make up` démarre aussi le conteneur **pebble**
  (fixture ACME locale, `PEBBLE_VA_ALWAYS_VALID=1`) — certbot ne parle **jamais** au
  vrai Let's Encrypt depuis les tests. Sa CA de test est partagée via le volume
  `pebble_test` (montée dans kobox-dev sous `/opt/pebble-test`). Env utiles :
  `KOBOX_LE_DOMAIN`/`KOBOX_LE_EMAIL` (arment le composant letsencrypt),
  `KOBOX_ACME_URL` (`https://pebble:14000/dir` en E2E), `KOBOX_ACME_CA_BUNDLE`,
  `KOBOX_BACKUP_ROOT`/`KOBOX_BACKUP_TTL_DAYS`/`KOBOX_BACKUP_KEEP_MIN`,
  `KOBOX_REPO_DIR`/`KOBOX_RELEASES_DIR`/`KOBOX_CURRENT_LINK` (upgrades).
  ⚠️ Les tests git/upgrade créent leurs **propres dépôts scratch** (`file://`) — le
  checkout monté n'est jamais muté (son `.git` est celui de ta machine). L'E2E
  upgrade flippe `/opt/kobox/current` vers des releases factices puis **restaure le
  lien en afterAll** ; pgl n'existe plus (ipset le remplace ; sur un kernel Docker
  sans `ip_set`, le composant se `skipped` honnêtement et seul le filtre rtorrent
  s'applique). Le worker systemd du conteneur draine les jobs pendant l'E2E : pour
  observer des jobs `pending`, stoppe `kobox-worker` d'abord.

- **Portal & Access (Phase 6)** : le portail SSR (`kobox-portal`, Fastify) tourne
  **non-root** sur `127.0.0.1:8190` (`KOBOX_PORTAL_HTTP_PORT`/`KOBOX_PORTAL_HTTP_HOST`)
  derrière nginx (`:8189`). L'auth est applicative : table `portal_credentials`
  (même hash sha512-crypt que le compte système, écrit par le **worker** sur
  create-user/change-password), sessions server-side hashées (`portal_sessions`),
  CSRF sur toute mutation, lockout 5 échecs/15 min (`login_attempts`). nginx délègue
  `/ru` + `/RPC-<USER>` + `/shell` au portail via `auth_request` (`/internal/auth[/rpc|/admin]`).
  Boucle de dev pure Mac : `pnpm test` couvre le portail avec des fakes
  (`test/component/interfaces/portalWorld.ts` : jar cookie + CSRF via `.inject()`).
  ⚠️ **DB partagée** : `/var/lib/kobox` est `2770 root:kobox-portal` (setgid) et les
  unités worker+portal tournent `UMask=0007` pour que les fichiers WAL/-shm de SQLite
  restent group-writable — le portail non-root ouvre la même base que le worker root.
  L'E2E portail (`test/e2e/portal-access.e2e.test.ts`) crée le groupe `kobox-portal`
  (précondition normalement posée par `kobox-core`), fournit une **PKI fixture**
  (easy-rsa absent du conteneur — l'émission réelle des certs VPN est le job de
  l'E2E security), lance le portail en process enfant et le pilote en HTTP avec un
  jar cookie (le cookie `Secure` est renvoyé manuellement en clair sur 127.0.0.1).
  Env utiles : `KOBOX_VPN_PROFILES_DIR` (défaut `/etc/kobox/vpn-profiles`, lu par le
  portail pour servir les `.ovpn`). `kobox set-samba-password <user>` lit le mot de
  passe sur stdin (jamais en DB/job).

## VM Multipass (validation full-stack, quotas ext4 réels)

```bash
brew install --cask multipass
multipass launch --name kobox-test --cpus 4 --memory 8G --disk 30G 24.04   # ou une image Debian
multipass mount ~/Project/KoBox kobox-test:/opt/KoBox
multipass shell kobox-test
# dans la VM : installer node 24, puis KOBOX_QUOTA_FS=/ pnpm test:int
```

## Garde-fous

1. **Jamais** de test contre la seedbox de prod (`HANDOFF.md`).
2. Le legacy (`install/ web/ inc/ bin/ scripts/ templates/ upgrade/`) est en lecture seule.
3. `pnpm lint` interdit `any` ; le domaine n'importe ni Drizzle, ni pino, ni node:*.
