# KoBox — Audit du legacy MySB & plan cible

> **Statut** : audit initial. Zéro fichier de code modifié.
> **Posture** : rewrite ambitieux, propre à long terme, testé à fond. Le legacy MySB
> (bash + PHP) est traité comme **inventaire fonctionnel**, pas comme socle technique à
> préserver. La *feature list de the owner* (voir `HANDOFF.md`) doit rester **fonctionnellement
> intacte pour l'utilisateur final** — le rewrite est invisible pour lui.
> **Contrainte structurante** : bus factor = 1. Chaque décision est justifiée par
> « je sais maintenir ça seul dans 3 ans ». Boring tech first.

Toutes les références sont ancrées `fichier:ligne` sur l'arbre `toulousain79/MySB@083101d`
(le mirror actuel de KoBox, branche `v7.3`).

---

## 0. Résumé exécutif

MySB est un installeur de seedbox multi-utilisateurs pour Debian, ~90 k lignes tracées
(~53 k `web/`, ~37 k `templates/`, ~11 k `inc/`, ~9 k `install/`) dont l'essentiel du code
*métier* tient dans **inc/ + install/ + bin/ + scripts/ + web/pages+inc** (~30 k lignes de
bash et PHP écrites à la main ; le reste est vendored — ruTorrent, Wolf CMS, jQuery — ou
des templates de config).

**La découverte structurante de l'audit** : MySB n'est pas « un script d'install ». C'est un
**système à état** dont le cœur est une base de données relationnelle MySQL (`MySB_db`,
27 tables) et un **bus de commandes** : le portail PHP n'exécute jamais rien de privilégié
lui-même — il **écrit des lignes dans la table `commands`**, puis un script root
(`scripts/ApplyConfig.bsh`, lancé via `sudo` par `www-data`) dépile ces commandes et exécute
les installeurs/scripts en root. Ce bus est **à la fois le meilleur candidat de séparation
architecturale** (frontière application/domaine naturelle) **et le pire trou de sécurité**
du projet.

**Les trois problèmes de fond** (détaillés §5) :

1. **Modèle de privilèges cassé — escalade root triviale.** Un `NOPASSWD` avec glob final
   `/bin/bash /home/${user}/.rTorrent_tasks.sh*` (`bin/MySB_CreateUser:176`) permet à
   *n'importe quel utilisateur seedbox* de devenir root en une commande. Combiné à un fichier
   `chmod 0666` traité par root (`.check_annoncers`, `funcs_MySB_CreateUser:437`) et au
   `www-data … ApplyConfig.bsh*` (`install/Nginx:143`), la surface d'escalade est totale.
2. **Régénération destructive.** Fichiers de conf utilisateur, firewall, jails, DNS,
   `resolv.conf` sont **truncate + réécrits à chaque passage** — toute édition manuelle ou
   tout échec en cours de route est perdu. C'est l'anti-pattern nommé par le HANDOFF.
3. **Aucune frontière de type.** ~100 variables bash globales hydratées depuis la DB à chaque
   invocation (`inc/vars`), **368 sites d'appel `cmdMySQL`** en interpolation de chaîne (SQLi
   partout), arguments métier empaquetés en chaînes `pipe`-délimitées (`user|sftp|sudo|…`).
   Primitive obsession totale.

**Recommandation principale** (argumentée §3) : rewrite en **TypeScript strict** (Node LTS),
architecture hexagonale, **une seule base SQLite** (fusionne l'actuel MySQL + 3 SQLite), portail
**SSR monolithe modulaire**, couche `infrastructure/system/` isolant les mutations réelles
(apt/systemctl/useradd/iptables) derrière des ports testables. Le bus `commands`+sudo est
remplacé par un **worker root systemd consommant une file de jobs typée** écrite par le web
non-privilégié. **Phase 0 = bounded context User Management**, en strangler à côté de MySB.

**Ce qui reste en bash irréductible** : un stub de bootstrap (~50 lignes : installe Node, clone,
lance `kobox install`) + de fins shims d'événements rtorrent (`event.download.finished` →
`kobox torrent-event …`). Tout le reste devient du TS testable.

---

## 1. Inventaire fonctionnel par bounded context candidat

Regroupement des capacités réelles observées, mappées sur la feature list de the owner. Chaque
capacité est ancrée sur le code legacy.

### 1.1 Installation & Provisioning (host bootstrap)

| Capacité | Ancre |
|---|---|
| Sélection langue FR/EN, pré-checks (Debian, arch, root, ext4, pas de LVM, kernel) | `install/MySB.bsh:39-50,310-465` |
| Upgrade Debian 9→10 optionnel, remplacement kernel OVH | `install/MySB.bsh:243-283` |
| Génération `/etc/apt/sources.list` via `netselect-apt` (miroir le plus rapide) | `install/SourcesList:54-172` |
| Purge/install de bundles de paquets curés | `install/Packages:48-82` |
| Hardening/optim host (sysctl, iptables-legacy, AES-NI, governor, GRUB, fstab, units) | `install/Tweaks:28-356` |
| Orchestration de ~45 installeurs de composants en 4 phases | `install/MySB.bsh:90-463` |
| Survey interactif → écriture DB | `install/Questions:324-983` |
| Registre service `to_install`/`is_installed`/`used` | table `services`, `inc/vars:304-382` |
| Teardown complet (reverse) | `install/MySB_CleanAll.bsh:40-142` |

**Langage ubiquitaire** : *survey*, *step*, *service*, *provider* (OVH/ONLINE/HETZNER…),
*revision*, *switch* (INSTALL/REFRESH/UPGRADE/CRON), *tweak*, *repository*.

### 1.2 User Management & ressources par utilisateur

| Capacité | Ancre |
|---|---|
| Créer un user (2 modes : interactif / `APPLYCONFIG` portail) | `bin/MySB_CreateUser:57-371` |
| Supprimer un user (services, binds, cron, exports, DB, `userdel`) | `bin/MySB_DeleteUser:67-204` |
| Changer mot de passe (système + Samba + NextCloud + 2× htpasswd nginx + ruTorrent) | `bin/MySB_ChangeUserPassword:62-118` |
| Allocation ports SCGI/rTorrent/proxy (`max()+1`) | `bin/MySB_CreateUser:92-100` |
| Quota ext4 (auto/manual/plex), rééquilibrage global | `funcs_MySB_CreateUser:245-346` |
| SFTP chroot (`Match Group mysb_users` → `ChrootDirectory /home/%u`) | `install/SSH:99-115` |
| Partages Samba `[homes]` + exports NFS par user | `templates/samba/…`, `bin/MySB_CreateUser:243-258` |

**Ressources provisionnées par user** : ligne DB `users`, compte système + home, groupes,
`sudoers.d`, ports, instance rTorrent + init, confs nginx rpc/upstream/passwd, quota, chroot FTP,
bind-mounts, export NFS, Samba, bucket Minio, compte NextCloud, keypair SSH, alias postfix,
logrotate, cron.

**Langage ubiquitaire** : *seedbox user* / *main user*, *account type* (normal/plex),
*quota type* (auto/manual/plex), *RPC handle*, *chroot*, groupes `mysb_users`/`sshdusers`.

### 1.3 Torrent Lifecycle (rTorrent / ruTorrent)

| Capacité | Ancre |
|---|---|
| Build rTorrent+libTorrent depuis source (gating version) | `install/rTorrent:29-84` |
| ruTorrent + ~25 plugins/thèmes (clone + patch) | `install/ruTorrent:46-212` |
| Instance rTorrent par user (SysV `rtorrent-<user>`, `start-stop-daemon --chuid`) | `templates/rtorrent/etc.init.d.rtorrent.tmpl:305-355` |
| Génération `.rtorrent.rc` par user depuis template | `funcs_MySB_CreateUser:686-909` |
| Watch dirs multi-user / multi-label (`config.d/80-watch.rc`) | `funcs_MySB_CreateUser:866-908` |
| SCGI `127.0.0.1:<scgi_port>`, contrôle via `xmlrpc2scgi.py` | `templates/rtorrent/rtorrent.rc.tmpl:130` |
| Hooks post-download (`inserted_new`/`finished`/`erased`) + fan-out `~/scripts/*.sh` | `rtorrent.rc.tmpl:70-74` |
| Daemon inotify de sync `~/rtorrent/complete` ↔ rTorrent+DB | `etc.init.d.rtorrent.tmpl:237-273` |
| **Priorité SSL rTorrent** (`ssl_verify_peer/host=1`, `capath=/etc/ssl/certs`) | `rtorrent.rc.tmpl:98-102` |
| Recyclage fichiers (copie simple / hard link) | `custom5` params, `rtorrent_inserted_new.sh.tmpl:63-66` |

**Langage ubiquitaire** : *rTorrent instance*, *watch directory* / *label* (`custom1`),
*session dir*, *event hook*, *announcer* (annoncer), *torrent* (info_hash/state), *recycling*.

### 1.4 Tracker & Blocklist (feature signature MySB)

| Capacité | Ancre |
|---|---|
| **Cert SSL auto par tracker** (`openssl s_client` → PEM → `/etc/ssl/certs`) | `funcs_GetTrackersCert.bsh:393-504` |
| Découverte trackers depuis les torrents (parse announcers → `trackers_list`) | `funcs_GetTrackersCert.bsh:196-391` |
| Renouvellement cert (cron : `cert_expiration <= today`) | `scripts/GetTrackersCert.bsh:99-109` |
| Whitelist trackers via zones BIND + hosts + dnscrypt allow/block | `funcs_MySB_SecurityRules:278-359` |
| Blocklists iblocklist (catalogue XML → SQL) + listes perso | `funcs_PeerGuardian:30-159` |
| PeerGuardian `allow.p2p` (IP users+trackers) + `custom.insert.sh` | `funcs_PeerGuardian:469-762` |
| Blocklist rTorrent (`ipv4_filter.load` par user) | `scripts/BlocklistsRTorrent.bsh` |
| Filtrage annonceurs bloqués (tracker banni ⇒ retiré d'`allow.p2p`) | `funcs_GetTrackersCert.bsh:430-438` |

**Langage ubiquitaire** : *tracker* (privacy public/private, `is_ssl`, `to_check`∈{0,1,3},
`is_dead`), *tracker certificate*, *blocklist* (perso vs iblocklist / subscription),
*PeerGuardian / PGL allow-list*, *announcer*.

### 1.5 Security & Network

| Capacité | Ancre |
|---|---|
| Firewall (default-deny, chaînes par user, modes clean/create/refresh) | `bin/MySB_SecurityRules:143-233`, `inc/funcs_iptables` |
| Fail2Ban (jails sshd-ddos/nginx/nextcloud, `ignoreip` dynamique) | `funcs_Fail2Ban:31-102` |
| **Restrict IP dyndns** (résout hostname → refresh firewall/whitelists) | `scripts/DynamicAddressResolver.bsh:35-64` |
| DNScrypt-proxy + Bind9 cache/filtrage | `install/DNScrypt`, `install/Bind` |
| Let's Encrypt (certbot standalone, HSTS, renew hooks nginx) | `install/LetsEncrypt:44-251` |
| OpenVPN multi-config TUN/TAP (avec/sans gateway), bridge br0 | `install/OpenVPN`, `scripts/OpenVPN-Bridge.bsh` |
| RKHunter / Lynis / Portsentry | `install/{RKHunter,Lynis,Portsentry}` |

**Langage ubiquitaire** : *SecurityRules* (scope `--users|--trackers|--blocklists|--all`),
*user chain*, *jail* / *ignoreip*, *DynDnsHost*, *IP restriction*, *VpnConfig* (TUN/TAP,
with/without gateway).

### 1.6 Portal & Access (l'admin web)

| Capacité | Ancre |
|---|---|
| Portail = **thème Wolf CMS + pages custom** | `web/pages/*.php`, `web/index.php` |
| Auth = **HTTP Basic Auth** déléguée au serveur web | `web/inc/includes_before.php:28-30,109-115` |
| Gestion trackers / blocklists / users / adresses / sync / renting | `web/pages/*` |
| **Bus « Apply configuration »** : enqueue dans `commands`, puis `sudo ApplyConfig.bsh` | `web/pages/ApplyConfig.php:32`, `web/inc/functions.php:816-864` |
| ruTorrent linké/iframe (`href="ru"`), **pas embarqué** | `web/inc/functions.php:351` |

**Langage ubiquitaire** : *command* / *apply configuration* (priority, args, reload),
*main user* (admin sentinel), *service registry*, *address* (check_by ipv4/hostname).

### 1.7 Maintenance & Ops

| Capacité | Ancre |
|---|---|
| Self-update GitHub (`git reset --hard` + `pull` sur soi-même) | `bin/MySB_GitHubRepoUpdate:40-42` |
| Upgrade version-à-version (pipeline `From_v7.2-to-v7.3.bsh`) | `upgrade/From_v7.2-to-v7.3.bsh` |
| Migration host→host (mysqldump + `pv | mysql`) | `upgrade/Migration.bsh:443-553` |
| Système de *revision* (`rev X.Y`) + drift md5 | `inc/revisions`, `funcs_tools:968-1002` |
| Backups (Backup-Manager, TTL 7j) | `install/BackupManager:28-55` |
| Cron (schedules hardcodés + watchdog `MySB_jobs_check`) | `install/Cron:34-124` |
| Mail : outbox queue `mails` + relay Postfix/stunnel (FREE/GMAIL/OVH/…) | `inc/funcs:71-161`, `install/Postfix` |
| **Renting / treasury / payment reminder** (sous-domaine facturation) | `funcs_MySB_CreateUser:912-1117` |
| Monitoring (NetData, Logwatch, allowlist IP provider) | `install/{NetData,Logwatch,Monitoring}` |

**Langage ubiquitaire** : *upgrade* / *migration* / *revision* / *drift*, *outbox*,
*SMTP provider*, *cron job* / *jobs-check watchdog*, *treasury* / *rent period* /
*payment reminder*.

### Composants vendored (à **garder**, on configure — on ne réécrit pas)

ruTorrent, rTorrent/libTorrent (rakshasa), Wolf CMS (host du portail), Bind9, DNScrypt-proxy,
OpenVPN, Fail2Ban, nginx, Plex/Tautulli, NextCloud, Webmin, Seedbox-Manager, Cakebox, Minio,
Samba, Postfix. **Question ouverte** (§7) : plusieurs sont des extras lourds (Wolf CMS,
Cakebox, Minio, NextCloud, Webmin, ShellInABox) dont l'abandon réduirait drastiquement la
surface du rewrite.

---

## 2. Bounded contexts proposés

Sept contextes, alignés sur le langage métier découvert. Chacun devient un module autonome
(`domain/<context>/`) avec ses Value Objects, entités, agrégats et ports.

| # | Bounded context | Responsabilité | Agrégat racine | Type |
|---|---|---|---|---|
| 1 | **Installation** | Bootstrap host, installeurs de composants, état service/revision | `Installation`, `Component` | Core (support) |
| 2 | **User Management** | Cycle de vie compte + ressources (quota, ports, chroot, shares) | `SeedboxUser` | **Core** |
| 3 | **Torrent Lifecycle** | Instance rTorrent, watch dirs, torrents, hooks | `TorrentInstance` | Core |
| 4 | **Tracker & Blocklist** | Trackers, certs SSL par tracker, whitelist, blocklists | `Tracker`, `Blocklist` | **Core (signature)** |
| 5 | **Security & Network** | Firewall, fail2ban, DynDNS restrict, VPN, DNS | `FirewallPolicy` | Core |
| 6 | **Portal & Access** | Admin web, auth, dispatch des intentions | `AdminSession`, `Job` | Interface + Application |
| 7 | **Maintenance & Ops** | Upgrades, backups, mail/outbox, cron | `UpgradePlan`, `Outbox` | Support |
| 8 | **Observability & Fair-use** | Métering par user, sondes de santé, politique fair-use, réponse graduée, alertes | `FairUsePolicy`, `HealthCheck` | **Core (le pain user-h)** |
| (8b) | **Billing** (candidat) | Renting, treasury, payments | `RentPeriod` | Generic (extractible) |

### Value Objects candidats (no primitive obsession)

`UserId`, `Username` (lowercase, charset, longueur ≤32, noms réservés root/plex/ftp),
`Quota` (unité Kb, ≥0), `QuotaPolicy` (auto/manual/plex), `Port` (1-65535, unicité, pool),
`ScgiPort`, `RtorrentPort`, `AccountType`, `EmailAddress`, `TrackerHost` (FQDN shell-safe),
`TrackerProto` (http/https/udp), `CertExpiry`, `IpAddress`/`Cidr`, `DynDnsHost`, `BlocklistUrl`,
`JailName`, `VpnConfig`, `Version` (semver-ish, `isNewerThan`), `Revision`, `CronSchedule`,
`SmtpCredentials` (encapsule le secret), `MailUseCase` (enum fermé), `RentPeriod`, `Treasury`,
`Bandwidth` (bit/s), `EgressRate`/`ConnectionRate` (fenêtre glissante), `FairUsePolicy` /
`ResourceBudget` (par user : egress soutenu, taux conn, quota), `Threshold`, `UserStatus`
(active/suspended), `HealthStatus`, `AlertChannel` (ntfy/email/discord).

Règle : `string`/`int`/`bool` bruts **uniquement à la frontière I/O** (parse Zod → VO à
l'entrée, VO → string à la sortie). « Parse, don't validate ».

### Context map (relations)

```
                 ┌─────────────────────────────────────────────┐
   HTTP (admin)  │  Portal & Access  (Interface + Application)  │
   ───────────►  │  auth · use cases · Job queue (typée)        │
                 └───────┬───────────────────────────┬─────────┘
                         │ commandes typées          │
        ┌────────────────┼───────────────┬───────────┼──────────────┐
        ▼                ▼               ▼            ▼              ▼
  ┌───────────┐   ┌────────────┐  ┌───────────┐ ┌──────────┐ ┌────────────┐
  │   User    │   │  Torrent   │  │ Tracker & │ │ Security │ │Maintenance │
  │Management │◄─►│ Lifecycle  │◄►│ Blocklist │◄►│& Network │ │  & Ops     │
  └─────┬─────┘   └─────┬──────┘  └─────┬─────┘ └────┬─────┘ └─────┬──────┘
        └───────────────┴───────────────┴────────────┴────────────┘
                                   │ ports
                    ┌──────────────▼───────────────┐
                    │ infrastructure/system/        │  (apt, systemctl, useradd,
                    │ (root worker, adapters + fakes)│   iptables, openssl, fs)
                    └───────────────────────────────┘
```

- **Portal → contextes** : aujourd'hui *shared kernel via table DB* (`commands`) + sudo — le
  pire couplage. Cible : le portail invoque des **use cases applicatifs** (in-process) ou
  enqueue des **Jobs typés** consommés par le worker root. La frontière web↔root cesse d'être
  « n'importe quel argument shell ».
- **User Management ↔ Torrent/Security** : Customer/Supplier. Créer un user déclenche
  provisioning rTorrent + règles firewall. Relation via events de domaine (`UserCreated`).
- **Tracker & Blocklist ↔ Security** : partenariat (le cert promeut un tracker en https ET
  ouvre `allow.p2p` + zone DNS). Grey zone assumée (voir plus bas).
- **infrastructure/system** = **Anti-Corruption Layer** vers le monde Debian. Le domaine ne
  connaît que des ports (`SystemPort`, `PackagePort`, `FirewallPort`, `CertPort`,
  `FilesystemPort`), jamais `apt`/`systemctl` en dur.

### Zones grises assumées (à trancher au fil de l'eau, pas maintenant)

- **Tracker** vit entre Torrent (découverte depuis torrents), Cert (TLS) et Security
  (blocklist/DNS). Choix : contexte dédié **Tracker & Blocklist**, qui publie des events
  consommés par Security. Alternative : le fondre dans Security. À réévaluer en Phase 3.
- **Le bus `commands`** n'est pas un domaine : c'est un mécanisme d'application (dispatch de
  Jobs). Modélisé comme `application/jobs/`, pas comme entité métier.
- **Billing** (renting/treasury) est un *generic subdomain* couplé par accident à User
  Management (`funcs_MySB_CreateUser:912-1117`). Extractible ; candidat à être coupé de la v1
  si the owner n'en a pas besoin (§7).

---

## 3. Architecture cible

### 3.1 Choix du langage — argumenté

Le domaine a **deux visages** : (a) orchestration système (le gros de MySB : shell-out vers
apt/systemctl/useradd/iptables, génération de fichiers de conf, provisioning) et (b) portail
web (CRUD sur le modèle relationnel + bus + auth). MySB les traite en **deux runtimes** (bash
+ PHP-FPM) — c'est une source majeure de complexité. **Unifier sur un seul langage divise la
surface mentale par deux** — c'est le levier n°1 pour un bus factor de 1.

| Critère (pondéré bus-factor-1) | TypeScript (Node LTS) | Go | Python (FastAPI) | PHP 8 (Symfony) |
|---|---|---|---|---|
| Langue native d'the maintainer | **★★★** (son `CLAUDE.md` global = règles TS) | ★ | ★★ | ★ |
| Un seul langage CLI **+** web | **★★★** | ★★ (web ok mais verbeux) | ★★★ | ★★ (CLI PHP rare) |
| Modélisation VO / invariants | ★★★ (strict + branded types + Zod) | ★★ (pas de sum/branded types) | ★★ (pydantic runtime) | ★★ (readonly/enum) |
| Test pyramid | ★★★ (vitest+testcontainers+playwright) | ★★ | ★★★ (pytest) | ★★ (phpunit) |
| Shell-out / adaptateurs système | ★★ (`node:child_process`) | ★★★ | ★★★ | ★★ |
| Distribution (installeur curl-pipe) | ★★ (runtime requis) | **★★★** (binaire statique) | ★ | ★ |
| Boring / stabilité 3 ans | ★★ | **★★★** | ★★ | ★★ |

**Recommandation : TypeScript strict.** Raisonnement honnête :

- **Bus factor 1 = critère dominant.** Le vrai risque de maintenance n'est pas la perf, c'est
  « est-ce que je relis ça sans effort dans 3 ans ». Pour the maintainer, la réponse est TS — ses
  standards globaux (`any` interdit, `readonly`, optional chaining) *sont* du TS. Choisir Go
  ou Python, c'est ajouter une taxe d'onboarding permanente sur le seul mainteneur.
- **Un langage pour les deux moitiés.** CLI installeur *et* portail en TS. Schemas Zod
  partagés entre l'API, le worker et le CLI → contrats typés de bout en bout (voir §4).
- **TS strict + types brandés** rendent les VO réels et « illegal states unrepresentable » à
  la frontière I/O — exactement le mandat no-primitive-obsession.

**Runner-up honnête : Go.** Son unique avantage décisif est le **binaire statique** (idéal
pour un installeur `curl | sh`). Mais (1) l'installeur doit de toute façon installer une tonne
de choses via apt — le bootstrap peut installer Node ; (2) Go modélise mal les VO expressifs
(pas de types brandés ni de sommes) → plus de cérémonie ; (3) ce n'est pas la langue d'the maintainer.
La contrainte « binaire unique » est **mitigée** : le bootstrap bash installe Node LTS
(NodeSource) puis lance le CLI ; et si le binaire unique devient un jour la contrainte n°1, on
compile (`bun build --compile` / Node SEA). **Escape hatch documenté** : si la distribution
sans runtime devient bloquante, réévaluer Go pour la seule couche CLI.

**Rejetés** : **PHP/Symfony** (n'aide pas la moitié orchestration système, réintroduit le split
runtime, langue non-native) ; **Python** (bon 2e choix ops+web, mais typage runtime < TS strict,
langue non-native). **Rust/Elixir** : hors-scope (techno-showcase, viole boring-first).

#### ADR perf & budget ressources (le runtime TS est-il un problème sur la seedbox ?)

Question légitime : Node est-il trop lourd pour une seedbox « limitée » ? Réponse ancrée sur
les mesures prod (`docs/PROD-INSPECTION.md`) et le fait que **le prochain serveur sera
identique** (confirmé) : **15 GiO RAM / 4 vCPU, load 0.40**, et ce **déjà** avec 8× rtorrent +
MariaDB + nginx + php-fpm + bind + dnscrypt + 3× OpenVPN + Samba + NFS + netdata + docker.

- **Charge I/O-bound, pas CPU-bound.** KoBox orchestre (shell-out apt/systemctl/useradd/
  iptables), rend des fichiers de conf, fait du CRUD et sert un admin à ~8 users. Le travail
  lourd (transfert torrent, chiffrement VPN) est fait par rtorrent/openvpn/kernel — pas par
  KoBox. Le runtime du langage n'influe quasiment pas sur le débit.
- **Empreinte mémoire** : web + worker Node ≈ 100–150 Mo RSS ; un binaire Go ≈ 20–40 Mo. Sur
  ~14 GiO dispo, le delta est du bruit (un seul rtorrent consomme davantage).
- **Seul chemin perf-sensible** : les hooks d'événements rtorrent (`finished`/`inserted_new`)
  qui peuvent tirer 100×/min ⇒ un cold-start Node par event serait coûteux. **Neutralisé par
  l'archi** : les hooks sont des shims de 5 lignes qui parlent à un **daemon KoBox déjà chaud**
  (socket/HTTP), pas un spawn Node par event → sub-ms.
- **Escape hatch dans le langage** si le footprint devenait critique un jour : **Bun** ou
  binaire compilé (`bun build --compile` / Node SEA) — avant même d'envisager Go.

**Verdict** : sur les ressources seules, Go a un léger avantage (footprint/cold-start/binaire
unique), mais **immatériel sur ce hardware** (identique au prochain serveur) et écrasé par le
gain de maintenabilité TS. **Décision TypeScript verrouillée.** Le seul scénario qui l'aurait
inversée — cibler une box beaucoup plus petite (VPS 512 Mo–1 Go) — est **écarté** (serveur
cible identique).

### 3.2 Choix DB — argumenté

Le domaine est **franchement relationnel** (27 tables MySQL avec FK, la file `commands`, les
`tracking_rent_*`) — pas de la config plate. Aujourd'hui : **MySQL + 3 SQLite** (`Wolf.sq3`
CMS, `Blocklists.tmpl.sq3`, `Sync.tmpl.sq3`). Quatre datastores pour une seule machine.

**Recommandation : une seule base SQLite** (mode WAL), via une couche typée
(**Drizzle ORM** ou **Kysely** — query builder typé, migrations `drizzle-kit`).

- Bus factor 1 : **un daemon de moins** à installer/sécuriser/sauvegarder. SQLite = un fichier
  → backup = `cp` (ou `.backup`), restauration triviale.
- Volume réel : ~8 users, quelques milliers de torrents/trackers. SQLite tient largement.
- Fusionne les 4 stores en un seul schéma cohérent → supprime la duplication d'identité user
  (aujourd'hui dupliquée MySQL `users` / Wolf `user` / OS — une couture d'intégration décrite
  §1.6).
- Concurrence : lecteurs concurrents OK ; écritures sérialisées. On route **toutes les
  écritures via l'API/worker** (single-writer) — les shims rtorrent appellent `kobox` au lieu
  d'ouvrir la DB en direct.

**Caveat honnête** : si un jour multi-nœuds → Postgres. Mais c'est du YAGNI pour un serveur
dédié unique. Postgres ici = charge ops injustifiée.

### 3.3 Framework portail — SSR monolithe modulaire

L'admin sert ~8 personnes. Un **SPA React** ajoute build/déploiement/état-synchro pour un
bénéfice nul à cette échelle. **Recommandation : monolithe modulaire, API + pages rendues
serveur** (Fastify + moteur de templates type Eta/Nunjucks, ou Astro en SSR). ruTorrent reste
**iframé** comme aujourd'hui. Îlots React ponctuels seulement si une page l'exige. Zod pour
valider toute entrée à la frontière (remplace les `$_POST` bruts). Un seul process web.

### 3.4 Layout des couches (hexagonal) & arbo cible

```
kobox/
├── bootstrap/                     # BASH IRRÉDUCTIBLE (le strict minimum)
│   └── install.sh                 # installe Node LTS, clone, lance `kobox install`
├── src/
│   ├── domain/                    # AUCUNE dépendance externe. Pur métier.
│   │   ├── user/                  # SeedboxUser, Username, Quota, Port, ports (interfaces)
│   │   ├── torrent/               # TorrentInstance, WatchDir, hooks
│   │   ├── tracker/               # Tracker, TrackerCert, Blocklist
│   │   ├── security/              # FirewallPolicy, Jail, DynDnsHost, VpnConfig
│   │   ├── installation/          # Component, Service, Revision
│   │   ├── maintenance/           # UpgradePlan, Outbox, CronSchedule
│   │   └── shared/                # VO transverses (IpAddress, EmailAddress, Version)
│   ├── application/               # Use cases / command handlers. Orchestrent les ports.
│   │   ├── user/                  # CreateUser, DeleteUser, ChangePassword…
│   │   ├── jobs/                  # file de Jobs typée (remplace la table `commands`)
│   │   └── ...
│   ├── infrastructure/            # ADAPTATEURS (implémentent les ports du domaine)
│   │   ├── persistence/           # repos SQLite (Drizzle), migrations
│   │   ├── system/                # ⇐ mutations RÉELLES derrière interfaces + FAKES
│   │   │   ├── PackageAdapter     # apt/dpkg          (fake: InMemoryPackages)
│   │   │   ├── ServiceAdapter     # systemctl         (fake: FakeServiceManager)
│   │   │   ├── AccountAdapter      # useradd/usermod   (fake: FakeAccounts)
│   │   │   ├── FirewallAdapter     # iptables-restore  (fake: FakeFirewall)
│   │   │   ├── CertAdapter         # openssl/certbot
│   │   │   └── FilesystemAdapter   # rendu de templates de conf (golden files)
│   │   └── external/              # letsencrypt, smtp/postfix, github
│   └── interfaces/                # POINTS D'ENTRÉE
│       ├── cli/                   # `kobox install|create-user|upgrade…`
│       ├── http/                  # portail SSR + API (Fastify)
│       └── worker/                # daemon root systemd : consomme la file de Jobs
├── templates/                     # templates de conf (repris, versionnés, golden-tested)
├── test/                          # unit / component / integration / contract / e2e
└── docs/
```

**Règle de dépendance** : `interfaces → application → domain` ; `infrastructure → domain`
(implémente les ports). Le domaine ne dépend de rien. Le framework (Fastify, Drizzle) vit en
`infrastructure`/`interfaces` — **le domaine dicte la structure, pas le framework.**

### 3.5 Modèle d'exécution privilégié (le redesign central)

Remplacer `www-data ALL=(root) NOPASSWD: ApplyConfig.bsh*` + table `commands` par :

- Le **process web tourne non-privilégié**. Il **n'exécute jamais** de commande système.
- Il **écrit un `Job` typé** (enum d'action fermé + payload validé Zod) dans la file
  (table `jobs` SQLite ou socket).
- Un **worker root** (unité systemd, `interfaces/worker/`) est le **seul** à consommer la file
  et à toucher `infrastructure/system/`. Il **re-valide** chaque Job (defense in depth) et
  n'accepte qu'un ensemble d'actions connu — **aucun passage d'argument shell arbitraire**.
- Les shims d'événements rtorrent appellent `kobox torrent-event <type> --hash …` (CLI), qui
  enqueue un Job ou écrit via l'API — plus de sudo glob, plus de DB en direct.

Résultat : la compromission du web ne donne plus root ; la surface privilégiée est un
ensemble fini d'actions typées et testées.

### 3.6 Ce qui reste en bash irréductible

Périmètre **volontairement minuscule**, tout derrière `infrastructure/system` (donc testable
via fakes) ou isolé dans `bootstrap/` :

1. **`bootstrap/install.sh`** (~50 lignes) : pré-checks minimaux, installe Node LTS, clone,
   `exec kobox install`. C'est le seul bash « sur la vraie machine » lancé par un humain.
2. **Shims d'événements rtorrent** (`~/.rTorrent_{finished,inserted_new,erased}.sh`, ~5 lignes
   chacun) : rtorrent ne sait invoquer qu'un exécutable → ils appellent `kobox torrent-event`.
3. **Unités systemd générées** (fichiers, pas du code) : rendues par `FilesystemAdapter`,
   golden-testées.

Tout le reste (apt, systemctl, useradd, iptables, chmod/chown, openssl) devient des **appels
`execFile` typés** dans les adapters `infrastructure/system/`, avec interface + fake. On teste
la logique métier sans toucher une vraie machine ; on teste les adapters en intégration dans un
conteneur Debian 12 privilégié.

### 3.7 Observabilité & gouvernance fair-use (le cas user-h)

**Cause racine du cas user-h (2026-07-23)** : ce n'est **pas** l'absence de dashboard (NetData
tournait) mais l'absence de **(1) attribution par utilisateur**, **(2) alerte push**, et
**(3) réponse graduée automatique**. user-h a saturé l'upstream (1979 connexions SSH/jour, rsync
en boucle) → throttling fair-use du provider → box dégradée → détecté seulement quand the owner s'est
plaint, après des reboots. « Vraie observabilité » KoBox = **actionnable et par-user**, pas un
dashboard de plus que personne ne regarde.

**Trois couches** :

1. **Instrumentation** (cross-cutting, fondation — dès Phase 0) : logs JSON structurés,
   endpoint `/metrics` Prometheus (scrape optionnel), et **sondes de santé réelles**
   (process + socket, pas l'état systemd) — aurait attrapé le `rtorrent` crashé-mais-« active »
   et le **Minio `failed` silencieux 10 h** vus en prod. Ports : `ObservabilityPort`,
   `MetricsPort`, `HealthProbePort`.
2. **Métering par utilisateur** (contexte Security & Network) : `UsageMeterPort` lit l'usage
   réel **par uid** — egress/ingress (compteurs iptables `-m owner` / stats tc), taux de
   connexion & d'auth SSH (journald — **là où fail2ban est aveugle** car clé publique valide),
   disque/quota, nb torrents. Rattaché à l'agrégat `SeedboxUser`.
3. **Gouvernance fair-use** (le gain) : VO `FairUsePolicy`/`ResourceBudget` par user ; service
   planifié `FairUseEvaluator` (domaine) compare observé vs policy → émet des events de domaine
   (`FairUseBreached`, `AbnormalAuthRate`, `ServiceUnhealthy`) → politique de **réponse graduée**.

**Décisions figées (the maintainer 2026-07-23)** :
- **Réponse graduée** : `alerte` → (si persiste) `throttle auto` via `ShapingPort` (tc/HTB — le
  script déjà testé sur user-h) → **la suspension reste manuelle** (`SuspendUser`, décidée par
  the maintainer). Réversible et auditée (events + historique) ; évite de couper un user légitime sur
  un faux positif (bus factor 1).
- **Canaux d'alerte** : **ntfy + email + Discord** via `NotificationPort` multi-canal (email
  réutilise le relais Postfix ; ntfy déjà utilisé sur le NAS ; Discord pour the owner/les users).

**Honnêteté (anti-overkill)** : un stack complet Prometheus + Grafana + Loki + Alertmanager +
tracing OTel pour **8 users / 1 mainteneur** est disproportionné. Reco **légère** : logs
structurés + `/metrics` optionnel + `FairUseEvaluator` + push. On **garde NetData** (déjà en
place) pour l'œil host ; Grafana/scrape Prometheus restent branchables plus tard sans rien
réécrire (l'endpoint est là).

**Placement** : instrumentation + sondes de santé en **Phase 0** (fondation) ; métering par-user
+ `FairUseEvaluator` + throttle en **Phase 3 (Security & Network)**, quand le contexte réseau
existe. La suspension auto-déclenchable réutilise `SuspendUser` (Phase 0).

---

## 4. Stratégie de test

Pyramide dense, du plus fréquent au plus rare. Cible : **>85 % lignes sur domain + application**.
Métrique réelle = expressivité (chaque test est un exemple exécutable du comportement métier),
pas la couverture brute.

| Niveau | Outils | Portée | Cible temps |
|---|---|---|---|
| **1. Unit** | vitest + **fast-check** (property-based) | VO, domain services, invariants. Ex. `Port` ∈ [1,65535] & unicité ; `Quota` conversions Kb ; `Username` charset ; `Version.isNewerThan`. | < 5 s total |
| **2. Component** | vitest + **fakes** des ports | Use cases isolés (CreateUser avec `FakeAccounts`/`FakeFirewall`). | < 15 s |
| **3. Integration** | vitest + **testcontainers** / sqlite temp réel | Repos vs vraie SQLite ; adapters système vs conteneur Debian 12 (`apt`/`useradd` réels) ; rendu de conf vs **golden files**. | secondes |
| **4. Contract** | schémas **Zod** versionnés + diff CI | API ↔ portail, API ↔ CLI, **payloads de Jobs** web↔worker. Détecte les breaking changes. | secondes |
| **5. E2E** | **Playwright** + conteneur/VM Debian 12 privilégié | « fresh Debian 12 → create user → rtorrent démarre → cert SSL fetché → quota appliqué ». Peu nombreux, high-signal. | minutes |
| **6. Smoke** | scripts post-deploy | Health checks après cutover. | secondes |

**Conventions** : nommage BDD-ish (`should_reject_username_when_reserved`, given/when/then).
**Fixtures** : Test Data Builders (`aUser().withQuota(Quota.gb(50)).build()`) — pas de setup
inline. **Mocks vs fakes vs stubs** : fakes pour les ports système (comportement complet en
mémoire), stubs pour les valeurs de retour simples, mocks réservés à la vérification
d'interaction (ex. « le worker a-t-il appelé `FirewallAdapter.apply` exactement une fois »).
**Test whisperer** (éviter la fragilité quand le domaine évolue) : tester le **comportement via
les ports**, jamais les internes ; golden files pour la génération de conf, revus au diff.

**CI GitHub Actions** (le legacy est en **GitLab CI** — `ci/.gitlab-ci.yml` : shellcheck +
détection de fonctions orphelines + install réelle en conteneur ; **à porter**, l'idée « lancer
l'installeur dans un Debian privilégié » est un bon précédent) :

| Job | Déclencheur | Cible temps |
|---|---|---|
| lint + typecheck + unit + component | chaque push | < 2 min |
| integration (testcontainers) | chaque PR | < 5 min |
| contract (Zod diff) | chaque PR | < 1 min |
| e2e (Debian 12 privilégié) | PR vers défaut + nightly | < 15 min |
| smoke | post-deploy | < 1 min |

---

## 5. Anti-patterns du legacy (leçons de MySB, localisés)

Ce sont les **erreurs à ne pas reproduire**, ancrées sur le code. Elles justifient les choix §3.

### 5.1 Sécurité — escalade de privilèges (CRITIQUE)

- **Sudo glob final = root trivial.** `bin/MySB_CreateUser:176` :
  `${user} ALL= EXEC: NOPASSWD: /bin/bash /home/${user}/.rTorrent_tasks.sh*`. Le vrai fichier
  est `root:root 0750`, mais le `*` matche tout suffixe et l'user possède `/home/${user}` :
  il crée `/home/${user}/.rTorrent_tasks.shX`, y met n'importe quoi, `sudo /bin/bash …shX` →
  root sans mot de passe. Dupliqué `bin/MySB_UpdateTools:103`.
- **Fichier world-writable traité par root.** `funcs_MySB_CreateUser:437` :
  `chmod 0666 …/.check_annoncers` ; combiné au sudo
  `GetTrackersCert.bsh USER ${user} [A-Z0-9]*` (`:175`), root lit/`sed`/`grep` du contenu
  contrôlé par n'importe quel user.
- **Web → root.** `install/Nginx:143` : `www-data … NOPASSWD: …/ApplyConfig.bsh*`. Toute
  RCE/écriture SQL dans le portail (qui tourne en www-data) devient root via ce seul grant.
- **Injection de commande via valeur DB en root.** `funcs_GetTrackersCert.bsh:452` :
  `timeout 10 bash -c "openssl s_client -connect ${Tracker}:${port} …"` — `${Tracker}` non
  échappé.
- **Cp/chown wildcard cross-home.** `bin/MySB_CreateUser:171` : `/bin/cp -av /home/*/rtorrent/*`
  → vol de données inter-utilisateurs en root.
- → **Leçon** : §3.5 (worker root typé), VO `Username`/`TrackerHost` shell-safe, aucun argument
  shell arbitraire, `visudo -c` supprimé du paysage.

### 5.2 Régénération destructive (l'anti-pattern nommé par le HANDOFF)

- `.rtorrent.rc` : garde « ne pas écraser » **commentée**, `bCreateNewFile=1` inconditionnel,
  ancien fichier → `.old` à **chaque** start/reload (`funcs_MySB_CreateUser:701-706,794-797`).
- `resolv.conf` réécrit chaque run (`install/MySB.bsh:584`), `sources.list` clobbered
  (`SourcesList:99`), `/root/.bashrc` écrasé (`Tweaks:41`).
- firewall/jail.local/allow.p2p/blocklists.list/zones DNS : `>`-truncés + reconstruits à chaque
  refresh (`funcs_MySB_SecurityRules:161,281,315`, `funcs_PeerGuardian:453,487,534`).
- **Mutation cross-user dans une fonction per-user** : `gfnCreateRtorrentConfigFile("$sUser")`
  réécrit le `.rtorrent.rc` de **tous** les users (`funcs_MySB_CreateUser:829-835`).
- → **Leçon** : état désiré déclaratif + rendu idempotent, golden-testé ; jamais de `>` sur un
  fichier potentiellement édité sans merge/diff explicite.

### 5.3 Primitive obsession & état global implicite

- ~100 globals `gs*/gb*/gn*` hydratés depuis la DB à chaque `source inc/vars` et consommés
  positionnellement par tous les installeurs (`inc/vars:150-451`).
- Args métier empaquetés en chaînes pipe-délimitées, dépaquetés par
  `IFS='|' read -r -a array` : `user|sftp|sudo|email|type|quota` (`ApplyConfig.bsh:105-111`),
  `custom5 = isStart:isAddPath:saveTorrent:isFast` (`rtorrent_inserted_new.sh.tmpl:63-66`).
- Booléens en chaînes `'1'`/`'0'` comparées partout (`web/pages/TrackersList.php:57`).
- → **Leçon** : VO partout (§2), Zod à la frontière, enums fermés.

### 5.4 Couplage SQL & injection

- **368 sites `cmdMySQL`** en interpolation de chaîne (56 fichiers) — aucune couche repository.
- SQLi confirmée côté portail : `web/inc/functions.php:599` construit
  `… name='".$username."' … password='".$password."' …` puis `PDO->exec()`, `$username` venant
  du header Basic-Auth.
- → **Leçon** : repositories typés (Drizzle/Kysely), requêtes paramétrées, zéro SQL string-built.

### 5.5 Portail web (défauts de conception)

- Auth = HTTP Basic déléguée ; **impersonation ouverte** : `$CurrentUser` surchargeable par
  `$_GET['user']` (`includes_before.php:112-114`).
- **Mot de passe passé en query string** et ré-affiché (`ChangePassword.php:28-30`).
- **Aucun CSRF** sur les formulaires mutants (`TrackersList.php:111`, etc.).
- **Mots de passe quasi-cleartext** : `users_passwd varchar(32)`, args `"$user|$new_pwd"`,
  `sasl_passwd` en clair sur disque (`install/Postfix:150`).
- HTML/PHP/SQL mélangés dans un même fichier (`Synchronization.php` 823 LOC, menu = `switch`
  de 280 lignes echo `<li>`).
- → **Leçon** : auth applicative (session + hash argon2), CSRF tokens, secrets hashés/chiffrés,
  séparation stricte view/use-case/persistence.

### 5.6 Ops fragiles

- **Self-update git-pull-sur-soi** sans vérif ni rollback : `git reset --hard origin/… ; git
  pull` (`MySB_GitHubRepoUpdate:40-42`) ; le script se réécrit sous son propre PID ; `reset
  --hard` jette tout état local.
- **Reboot forcé mid-upgrade** sans rollback (`MySB_UpgradeMe:276`).
- **Migrations destructives** : `TRUNCATE`/`DELETE` avant restore (`Migration.bsh:412-417`,
  `MySQL.bsh:16,19`).
- **Dispatch par `screen` + busy-wait**, aucune propagation de code retour : le `$?` inspecté
  est celui de la boucle d'attente, pas du worker (`inc/funcs:582-603`, `funcs_tools:194-205`).
- **Aucun `set -euo pipefail` ni `trap`** dans toute la couche install/lib.
- **TLS globalement désactivé** : `binCURL='curl … --insecure …'` (`inc/vars:86`) ; blocklists
  téléchargées sans vérif d'intégrité (`BlocklistsRTorrent.bsh:43`).
- → **Leçon** : upgrades transactionnels/versionnés, adapters avec codes retour typés,
  téléchargements vérifiés (hash/signature), erreurs propagées.

### 5.7 Bugs réels repérés en passant (preuve de la fragilité non-typée)

- `bin/MySB_DeleteUser:106,161` : `UserAccountType` **jamais assigné** → suppression Samba/VPN
  silencieusement sautée (comptes orphelins).
- `upgrade/MySQL.bsh:6` : `INSERT … VALUES ('Docker','0','1','1',);` (virgule finale) → erreur SQL.
- `rTorrent_inotify.sh.tmpl:57` : `SET tree='…' AND state='completed'` (`AND` au lieu de `,`) →
  colonne `state` jamais mise à jour.
- `DynamicAddressResolver.bsh:83` : `grep 'DynamicAddressResolver.bsh ${IfRunning} CRON'` en
  quotes simples → variable jamais expansée, le verrou anti-concurrence est **du code mort**.
- `locate "*${UserToDelete}*"` puis `rm` (`DeleteUser:184-192`) : un nom court matche des
  chemins non liés.

---

## 6. Plan de migration (strangler, incrémental)

Principe : **KoBox-new tourne à côté de MySB** ; pour une tranche donnée, le nouveau code
possède la fonctionnalité pendant que MySB possède le reste. **Fallback vers MySB upstream**
pendant toute la transition. Aucun big-bang. Rien touché en prod sans validation Docker+VM
(contrainte HANDOFF).

### Phase 0 — Vertical slice minimal (valide toute la stack)

Choix du 1er bounded context : **User Management**. Justification : il exerce **toute** la
stack (VO `Username`/`Quota`/`Port` ; persistence SQLite ; adapters système `useradd`/quota/
sftp ; worker root ; portail create-user) et c'est ce que les 8 users de the owner *ressentent*.

Livrables Phase 0 :
- Repo scaffoldé (arbo §3.4), toolchain TS strict, SQLite+Drizzle, CI GitHub Actions verte.
- `infrastructure/system` avec 3-4 adapters réels + fakes (`AccountAdapter`, quota, sftp).
- Use cases `CreateUser`/`DeleteUser`/`ChangePassword`/**`SuspendUser`/`ResumeUser`** avec
  pyramide de tests complète.
- Le worker root + file de Jobs typée (le redesign §3.5) en germe.
- **Instrumentation fondation** (§3.7 couche 1) : logs JSON structurés, `/metrics`, sondes de
  santé réelles + `NotificationPort` multi-canal (ntfy/email/discord) — posé dès Phase 0 car
  cross-cutting.
- E2E : conteneur Debian 12 → `kobox create-user` → compte + quota + chroot vérifiés, puis
  `kobox suspend-user` → SSH/FTP/rTorrent coupés, `kobox resume-user` → tout restauré.

**`SuspendUser`/`ResumeUser`** (issue upstream #39, jamais livrée — c'est le cas *user-h* vécu) :
opération de domaine sur l'agrégat `SeedboxUser` avec un état explicite `status ∈ {active,
suspended}`. Suspendre = **réversible et idempotent** : désactive l'accès SSH/SFTP (retire de
`sshdusers`/coupe la clé), arrête `rtorrent-<user>`, coupe l'accès portail — **sans supprimer
ni données ni compte**. Reprendre = restaure l'état d'avant. Aucun `mv authorized_keys.DISABLED`
ni sudoers hack manuel : l'état vit dans le domaine, l'effet passe par les ports système
(testables via fakes). C'est la version propre du kick/un-kick manuel documenté en mémoire.

**Done Phase 0** : E2E vert sur fresh Debian 12 ; parité fonctionnelle create/delete/passwd
**+ suspend/resume réversible** ; le chemin MySB correspondant peut être désactivé pour cette
tranche.

### Phases 1-N (ordre par risque/valeur)

1. **Torrent Lifecycle** — instance rTorrent, `.rtorrent.rc` déclaratif (fin de la regen),
   watch dirs, shims d'événements. (Valeur haute, ressenti user direct.)
2. **Tracker & Blocklist** — la feature signature (cert par tracker) ; VO `TrackerHost`
   shell-safe ; supprime l'injection root §5.1.
3. **Security & Network + Observabilité fair-use** — firewall/fail2ban déclaratifs, DynDNS
   restrict, VPN **+ métering par-user + `FairUseEvaluator` + throttle gradué** (§3.7 couches 2-3 ;
   règle fail2ban « publickey flood »). (Risque haut : ne pas se verrouiller dehors → E2E robustes
   d'abord.) → **c'est la tranche qui neutralise le cas user-h de bout en bout.**
4. **Installation & Provisioning** — l'orchestrateur de composants en TS (remplace `MySB.bsh`).
5. **Maintenance & Ops** — upgrades transactionnels, outbox mail, cron/worker, monitoring.
6. **Portal & Access** — dernière tranche : le portail SSR complet remplace le thème Wolf CMS ;
   auth applicative ; ruTorrent reste iframé.

**Done par phase** (critères communs) : E2E fresh-Debian-12 vert ; parité feature de la tranche
vs MySB ; ancien chemin retiré ; docs à jour ; CI < cibles §4.

**Ce qu'on garde tout du long** (on configure, on ne réécrit pas) : ruTorrent, rTorrent, Bind,
DNScrypt, OpenVPN, Fail2Ban, nginx, Postfix, et les extras retenus après la décision §7.

---

## 7. Ce qu'il faut décider avant de coder

Décisions à trancher (chacune bloque le scaffolding ou en change la forme) :

1. **Langage** : TypeScript strict (reco) vs Go. → *impacte tout.*
2. **DB** : une seule SQLite (reco, fusionne MySQL + 3 SQLite) vs garder MySQL. → *schéma & repos.*
3. **Portail** : SSR monolithe modulaire (reco) vs SPA React. → *interfaces/http.*
4. **Modèle privilégié** : worker root systemd + file de Jobs typée (reco) remplaçant
   `sudo ApplyConfig.bsh*`. Valider l'approche. → *sécurité, cœur du redesign.*
5. **Scope Phase 0** : tranche User Management en strangler à côté de MySB. Confirmer.
6. **Rename & chemins** : nouveau code sous `/opt/kobox` (fresh) — quelle stratégie de cutover
   vs l'existant `/opt/MySB` en prod ? (Coexistence pendant transition.)
7. **Périmètre features v1** — **figé ci-dessous** grâce à l'inspection prod
   (`docs/PROD-INSPECTION.md`). Restent 6 items « idle » en attente de confirmation the owner
   (défauts proposés, conservateurs).
8. **Billing** (renting/treasury/payments) : **hors-scope v1** — `tracking_rent_*` = 0 ligne
   en prod → sous-domaine inutilisé, extractible plus tard si besoin.

### Périmètre v1 figé (post-inspection prod)

**KEEP — cœur + tous les services** (directive the maintainer 2026-07-23 : « garde tous les
services » ; Minio réparé ; NextCloud utilisé par certains) :
rTorrent/ruTorrent + plugins (4283 torrents), Tracker & cert SSL par tracker (46 trackers
privés), Blocklist/PeerGuardian, DNScrypt + Bind, Fail2ban **(+ nouvelle règle « publickey
flood »)**, Let's Encrypt, Postfix/mail, **Portail réécrit** (même URL `:8189` + auth, design
libre — voir ci-dessous), sFTP chroot, **Quota → hard** (aujourd'hui soft uniquement),
Security/firewall, **NFS** (actif), **OpenVPN** (TUN/TAP, avec/sans GW), **Samba**,
**Minio** (réparé), **NextCloud** (utilisé), **Docker** (capability — modules compose futurs),
**Webmin**, **Seedbox-Manager**, **Cakebox-Light**, **ShellInABox**.

**Scope v1 : FIGÉ.** the owner : *« j'utilise webmin seedbox manager cakebox
etc »* → les 4 UIs alternatives sont **KEEP** (apps vendored, gardées/liées-iframées comme
ruTorrent). Note : **ShellInABox** est déjà bindé `127.0.0.1:4200`
derrière l'auth du portail — **à durcir** dans KoBox (localhost + auth), pas à retirer.
Le owner peut compléter la liste des retraits ultérieurement.

**Hors-scope v1 — non-services, prouvés inutilisés (ré-ajoutables plus tard)** :

| Feature | Preuve prod |
|---|---|
| Billing / renting | `tracking_rent_*` = 0 ligne (jamais utilisé) |
| port_forwarding | 0 ligne |
| Plex / Tautulli | non installé sur la box |
| **Wolf CMS** | remplacé par construction (le portail est réécrit) |

**Portail — décision de forme** : conserver l'**URL/entrée** actuelle (`https://seedbox.example:8189`
+ auth) pour que the owner reconnaisse l'accès, mais **re-design libre** du frontend (SSR propre). On
ne préserve pas le thème Wolf CMS pixel-perfect.

---

## Annexe — méthode d'audit

Audit read-only mené par 6 explorations parallèles (installation, user management, torrent
lifecycle, security & network, portail, maintenance) + vérifications directes (schéma MySQL,
grants sudo, CI GitLab, schémas SQLite). Aucun fichier de code modifié. Références `fichier:ligne`
sur `MySB@083101d`.

---

## Annexe B — Leçons des issues upstream (bugs réels rapportés)

Revue des issues GitHub `toulousain79/MySB` (19 ouvertes, projet abandonné — l'owner confirme
en 2023 sur #122 qu'il n'y touche plus). Elles **corroborent l'audit avec des pannes vécues**
et révèlent des features jamais livrées en 5 ans que KoBox doit intégrer d'emblée.

**Bugs récurrents → confirment les anti-patterns §5** :

| Issue(s) | Symptôme réel | Corrobore / implication KoBox |
|---|---|---|
| **#122** (open), #100, #119, #79, #51, #62, #64, #66, #67 | **Install brique le serveur** (Hetzner : plus de ping après 5 min ; échecs Debian 9/10, Kimsufi, « étape 14 », certbot, `/var/log/nginx` manquant, locales, DNS) | Le **#1 pain historique** = installeur destructif/fragile. Valide **E2E install en conteneur/VM privilégié + adapters idempotents** avant toute vraie machine (§4, §3.6) |
| **#120** | Ajout torrent → « Action non autorisée » **et** règle iptables PGL bloque le sortant hors 80/443 (YGG :8080) | Couplage **command-bus (sudo) ↔ firewall/blocklist** = exactement §5.1 + §1.5. KoBox : worker typé + politique réseau découplée |
| **#117** (open) | Listes de blocage à abonnement périmé **bloquent la MAJ des listes standards** ; pas d'alerte | Blocklist sans résilience/erreur (§5.6). KoBox : `Blocklist` VO + désactivation auto + alerte |
| #101 | `rpc.rquotad` **100 % CPU** (régression quota IPv6 Buster, couplé NFS) | Sous-système quota fragile + couplé NFS. KoBox : `Quota` adapter testable, découplé |
| #72 | **Calcul quota faux** : impossible de fixer un quota > espace libre car l'espace déjà utilisé par l'user n'est pas compté | Bug d'invariant. KoBox : `Quota` VO, max réglable = `used_by_user + free` |
| #107, #91, #58 | **Synchro post-download flaky/partielle** | Confirme le drift `sync_mode` **live** (`PROD-INSPECTION.md §5`). Contexte Sync à rendre déterministe |
| #114, #78, #112 | Upgrade / self-update fragile (process de fin inutile, reconstruction cron via GitHubRepoUpdate) | Confirme §5.6. KoBox : upgrades transactionnels/versionnés |
| #95, #94, #106 | rTorrent/ruTorrent **mauvaise combinaison de versions**, perte temporaire de config SSL | Build-from-source fragile. KoBox : versions pinnées + packaging propre |

**Features jamais livrées (5 ans) → à intégrer first-class dans KoBox** :

- **#39 « Pouvoir suspendre un utilisateur »** → capability **User Management (Phase 0)**. C'est
  exactement le cas *user-h* vécu (kick manuel réversible). Doit être une opération de domaine
  `SuspendUser`/`ResumeUser`, pas un hack sudoers.
- **#65 « Annuler une modification du portail »** → renforce le modèle **desired-state** + un
  historique/undo. C'est le pendant exact de la régénération destructive (§5.2) : l'utilisateur
  réclame un undo que l'architecture actuelle rend impossible.
- **#56 / #69 / #43 « Table des ports exploités » + « modifier les ports »** → valide le VO
  `Port` / `PortAllocator` explicite (§2), qui résout la primitive obsession + les races
  d'allocation `max()+1` (§5.3).

**Backlog post-v1 (demandes utiles, non bloquantes)** : #47 (faire transiter rTorrent par un
VPN **client** type NordVPN — jamais résolu, l'owner s'y est cassé les dents sur le bridge/iptables),
#49 (Plex multi-user), #50 (Pi-Hole), #38 (mail de rappel par user — lié au sous-domaine Billing),
#44 (héberger un site perso), #42 (changer le FQDN).

**Signal stratégique** : aucune issue ne contredit l'archi cible ; toutes pointent vers les
mêmes causes racines (installeur non testable, couplages implicites, primitive obsession,
régen sans undo). Le rewrite adresse la cause, pas les symptômes.
