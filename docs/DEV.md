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
