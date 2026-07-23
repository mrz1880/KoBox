# KoBox — Inspection de la seedbox MySB en production

> **Cartographie read-only** de l'état réel de MySB sur la seedbox de the owner
> (`seedbox.example` / `203.0.113.10`), le **2026-07-23**, pour informer les
> décisions d'architecture de KoBox (`docs/AUDIT.md`).
>
> **ZÉRO modification effectuée.** Uniquement des commandes de lecture
> (`cat/ls/find/grep/stat`, `git status/diff/log`, `systemctl status/list`,
> `iptables -L/-S`, `tc show`, `SELECT`/`SHOW`, `dig`, `openssl x509`).
> **Aucun fichier créé sur la seedbox** (vérifié). 7 sessions SSH batchées.
> Credentials jamais imprimés ni committés.

---

## Résumé — 5 découvertes qui changent l'archi KoBox

1. **Le drift vs upstream est nul côté source, total côté fichiers générés.** L'arbre
   `/opt/MySB` a un contenu **identique** à upstream `v7.3` (`git diff` = 344 fichiers
   « M » mais **0 ligne** modifiée = filemode/eol seulement, dû aux `chmod` d'install +
   self-update nightly). **Toute** la customisation vit dans les fichiers générés sous
   `/home` et dans la DB — jamais dans le code.
2. **Les patches DB survivent, les patches fichiers meurent.** Sur les 4 patches manuels
   documentés : `c411 is_active=1` et `rtorrent_notify=0` (DB) **tiennent** ; `sync_mode=0`
   et les 2 bypass de `~/.rTorrent_inserted_new.sh` (fichiers) ont été **effacés** par la
   régénération au dernier restart. C'est la **preuve empirique** de l'ADR « hooks
   post-install persistants ».
3. **L'identité utilisateur est quadruplée** : MariaDB `users` + compte OS + user Wolf CMS
   + sqlite Sync par user. C'est le couplage implicite n°1 à casser dans KoBox.
4. **Escalade root triviale, LIVE, pour les 8 users.** Les grants sudoers wildcards
   (`bash ~/.rTorrent_tasks.sh*`, `www-data … ApplyConfig.bsh*`) et `.check_annoncers`
   en `0666` sont **actifs en prod aujourd'hui**. Le redesign « worker root typé » de KoBox
   ne fait pas qu'assainir : il ferme un trou réel présent sur la box.
5. **Le serveur n'est pas contraint et la feature Billing est morte.** 15 GiO RAM / 4 vCPU
   à load 0.4 ; `tracking_rent_*` = **0 ligne** → la facturation/renting n'est pas utilisée.

---

## 1. État système

| Élément | Valeur |
|---|---|
| OS | **Debian 10.13 (buster)** — LTS terminé 2024-06-30, **~13 mois sans patch sécu** |
| Kernel | `4.19.0-27-amd64` (build 2024-06-25) |
| Uptime | depuis **2026-07-23 11:45** (jour du reboot-storm : 10:52 / 11:21 / 11:45) |
| MySB | **v7.3**, git HEAD `083101d` (2021-06-16) = **identique upstream** |
| Auto-update | `GitHubRepoUpdate` (cron 12:00) + `UpgradeMe` (cron 04:00 tous les 3j) → l'arbre est ré-épinglé sur `v7.3` en boucle (fichiers datés `juil. 22 04:00`) |
| Drift source | `git diff --stat` = **344 fichiers « M », 0 insertion / 0 suppression** → filemode/eol uniquement, **contenu = upstream** |
| Disque | 1× `sda` 3.7 T ; `sda4` = `/` **3.6 T, 64 % (1.3 T libre)** ; **pas de RAID** (`/proc/mdstat` absent) — concat/JBOD, aucune redondance |
| RAM / CPU / load | **15 GiO** (1.1 G utilisés, ~14 G dispo) / **4 vCPU** / **load 0.40** — box calme |

**Conséquence KoBox** : cibler Debian 12/13, ext4 + **hard quota**, envisager RAID/redondance
(hors périmètre logiciel). Le drift-zéro-source confirme qu'on peut ignorer le code prod
comme « fork » — c'est du vanilla MySB.

## 2. Configuration effective

**Bootstrap** — `/etc/MySB/config` : `MySB_InstallDir=/opt/MySB`, `MySB_Files=/opt/MySB_files`,
`EnvLang=fr`. Bug confirmé live : `/etc/MySB/config_db` en **`----rw----`** (le `chmod 060`
au lieu de `0600`, `inc/funcs`).

**Cron root — 26 lignes** (watchdog `/etc/cron.d/MySB_jobs_check` qui **redémarre cron si
`crontab -l | wc -l != 26`**). Principales :

| Fréquence | Job |
|---|---|
| `*/5` | `DynamicAddressResolver.bsh` (refresh IP restrict), `SendMails.bsh`, `DNScrypt-proxy.bsh check`, `NextCloud.bsh scan`, `PeerGuardian.bsh check`, **`.rTorrent_tasks.sh status` ×8 users** |
| `0 */1` | `LogServerAndQuota.bsh` |
| `0 */6` | `BlocklistsRTorrent.bsh`, `PeerGuardian.bsh update`, `LetsEncrypt renew` |
| `10 0 */1` | `GetTrackersCert.bsh` | 
| `5 0 */1` | `PaymentReminder.bsh` (tourne mais table rent vide) |
| `0 12` | **`GitHubRepoUpdate`** (self-update) |
| `0 4 */3` | `UpgradeMe` | `0 5 */7` | `UpgradeSystem` |

Cron par user : seul **user-a** (`~/scripts/synchro.sh` à 2h, sync NAS perso).

**Services actifs** : `bind9, dnscrypt-proxy, fail2ban, nginx, mariadb, php7.3-fpm, postfix
(+ stunnel4), smbd/nmbd, nfs-*, openvpn@{TUN_WithGW,TUN_WithoutGW,TAP_WithoutGW}, webmin,
shellinabox, netdata, docker, cron, ssh, rtorrent-{8 users}`. Les 8 `rtorrent-*` sont des
**services init.d LSB** `active` mais **systemd-`disabled`** (démarrés par cron/SecurityRules,
pas par systemd).

**Portail** — `nginx -T` : portail sur **`https://seedbox.example:8189`** (ssl http2,
`root /opt/MySB/web`), **HTTP Basic Auth** (`auth_basic "Restricted area"`).
ruTorrent sous **`/ru`**, Cakebox proxied `/cb/` (backend `:81`), webhook mail `:8888`
(`/rTorrent`, `/UserInfoMail`). Upstreams SCGI par user en **RPC majuscule** (`/LUDO`,
`/TONYZ`…). `conf.d/ip_restriction` régénéré `juil. 23 17:09`.

> **Décision « le portail garde-t-il son URL/design ? »** : l'accès actuel de the owner =
> `https://seedbox.example:8189` + Basic Auth + thème MySB. Si on veut qu'il **reconnaisse**
> le portail, KoBox doit préserver cette URL (ou rediriger) et une UX proche. Rien n'empêche
> un **re-design clean** du frontend tant que l'URL/entrée reste stable — c'est un choix
> ouvert (voir §9).

**OpenVPN** — 3 serveurs : `TUN_WithGW` **:8193** (`10.0.0.0/24`, `redirect-gateway`),
`TUN_WithoutGW` **:8194** (`10.0.1.0/24`), `TAP_WithoutGW` **:8195** (bridge `10.0.2.0/24`).
`proto udp4`, **`comp-lzo`** (compression dépréciée/risquée — VORACLE), `block-outside-dns`.
Profils client par user (5 variantes chacun, TUN/TAP × GW/noGW).

**DNS** — Bind9 `listen 127.0.0.1 + 10.0.{0,1,2}.1`, **forwarders → `127.0.0.1:52`** =
DNScrypt-proxy (`:52`, `require_dnssec/nolog/nofilter`, cache). Zone blacklist MySB **vide**
(cohérent avec 0 tracker inactif).

**PeerGuardian** — chaîne `pgl_in` en tête d'`INPUT` (policy **DROP**, 44 805 paquets
droppés), `allow.p2p` = **110 lignes** (IP users + trackers whitelistées). `blocklists.list`
PGL = commentaires seulement (les blocklists passent par la table MariaDB `blocklists`, 8
lignes iblocklist).

**Fail2ban** — 11 jails (`sshd, sshd-ddos, vsftpd, nginx-{auth,badbots,botsearch,login,
req-limit}, nextcloud, pam-generic, php-url-fopen`), **0 banni actuellement**.
⚠️ **Aucun jail ne capture le flood « Accepted publickey »** (le vecteur user-h : 1979
connexions/jour en clé valide) — confirme le besoin KoBox d'une règle custom.

## 3. Schémas des DB

**Central : MariaDB 10.3 `MySB_db`** (27 tables). Comptages de lignes (config, zéro donnée
perso lue) :

| Table | Lignes | | Table | Lignes |
|---|--:|---|---|--:|
| `torrents` | **4283** | | `users` | 8 |
| `trackers_list_ipv4` | 64 | | `users_rtorrent_cfg` | 53 |
| `trackers_list` | **46** (tous `private`) | | `users_addresses` | 36 |
| `providers_monitoring` | 18 | | `blocklists` | 8 |
| `minio` | 8 | | `users_history` | 7 |
| `users_scripts` | 6 | | `smtp` / `system` | 1 |
| `commands` | **0** (bus vidé) | | `mails` / `annoncers` | 0 |
| `tracking_rent_*` | **0** (Billing inutilisé) | | `repositories` | 0 |

**Par user : sqlite Sync** `~/db/<user>.sq3` (owner `<user>:www-data`) — tables
`categories` (`sync_mode`), `ident`, `list`, `backup_manager`. C'est le **plan de synchro
par utilisateur**, distinct du plan de contrôle central MariaDB.

**Modèle inféré** :
- **Plan de contrôle** (MariaDB) : `users` (ports SCGI 51101→51117 séquentiels, `proxy_port`
  **partagé 8080**, quota **uniforme 412 Gb**, `account_type=normal` ×8), `trackers_list`
  (1:N `trackers_list_ipv4`), `torrents` (par `users_ident`), `commands` (bus), `services`,
  `system`.
- **Plan de synchro** (sqlite/user) : `categories.sync_mode`, `list`/`ident` (jobs FTP/NAS),
  `backup_manager`.
- **Identité quadruplée** : `MySB_db.users` ⟷ compte OS ⟷ user Wolf CMS ⟷ sqlite/user.

## 4. Filesystem MySB

- `/opt/MySB` = **26 252 fichiers**, root-owned (la plupart `drwx------`), `install/` + `web/`
  world-readable. `.git` présent (root). `/opt/MySB_files` = cache d'artefacts téléchargés
  (cakebox-light, club-QuickBox, filemanager, composer.phar, docker-compose, ctop…).
- **Perms suspectes (toutes LIVE)** :
  - **sudoers wildcards** — `/etc/sudoers.d/MySB_tonyz` (idem pour les 8) :
    `NOPASSWD: /bin/bash /home/user-f/.rTorrent_tasks.sh*` (glob final → **root trivial**),
    `/bin/cp -av /home/*/rtorrent/*` (cross-home), `GetTrackersCert.bsh USER user-f [A-Z0-9]*`.
    `/etc/sudoers.d/MySB_nginx` : `www-data ALL=(root) NOPASSWD: … ApplyConfig.bsh*`.
  - **`.check_annoncers` en `0666`** (`root:mysb_users`) pour **les 8 users** — world-writable,
    traité par root via le sudo GetTrackersCert = injection cross-user/root.
  - **setuid root** : `/opt/MySB/web/apps/sm/reboot-rtorrent` (helper Seedbox-Manager).
  - `/etc/MySB/config_db` en `----rw----`.

## 5. Patches manuels d'the maintainer — statut live (drift vs upstream)

| Patch (source : mémoires) | Vecteur | Attendu | **Statut live 2026-07-23** |
|---|---|---|---|
| `c411.org is_active=1, is_dead=0` | **DB** (`trackers_list`) | actif | ✅ **TIENT** (`https`, port 411, actif) |
| `rtorrent_notify=0` user-f | **DB** (`users`) | 0 | ✅ **TIENT** (0 ; les 7 autres = 1) |
| `sync_mode=0` films/series user-f | **fichier** (sqlite regen au restart) | 0 | ❌ **REVERTÉ à 2** (restart 15:23) → user-f **synchronise involontairement** |
| 2 bypass `~/.rTorrent_inserted_new.sh` (Radarr early-exit + tracker public) | **fichier** (regen au restart) | présents | ❌ **DISPARUS** (regen `11:55`, aucune ligne `BYPASS-`) |

**Leçon centrale** : **DB survit, fichier meurt.** 2 patches DB sur 2 tiennent ; 2 patches
fichiers sur 2 sont effacés par la régénération. Le fork KoBox devra transformer les 2
patches fichiers en **comportement first-class** : colonnes/flags DB `allow_public_tracker`
(par user) et `sync_disabled` (par user), + un early-exit natif pour les adds XMLRPC sans
`.torrent`. → **nombre de patches à convertir en hooks persistants : 2.**

## 6. Cycle de régénération destructive (base de l'ADR « hooks persistants »)

Cartographie **déclencheur → fichiers régénérés → code** :

| Déclencheur | Régénère | Code (local `docs/AUDIT.md`) |
|---|---|---|
| **Restart `rtorrent-<user>`** (crash quota, MAJ MySB, UI, boot) | `~/.rtorrent.rc`, `~/.rTorrent_{inserted_new,finished,erased,tasks,inotify}.sh`, **reset `sync_mode=2`** | `gfnCreateRtorrentConfigFile` (`funcs_MySB_CreateUser:686-909`, `bCreateNewFile=1` forcé), install hooks `:761-783` |
| **`GetTrackersCert`** (cron 00:10 + à chaque insert torrent) | `/etc/bind/MySB.zones.blacklists`, `/etc/dnscrypt-proxy/blocked-names.txt` (depuis `trackers_list`) | `gfnGenerateBlacklistsZone` (`funcs_MySB_SecurityRules`) |
| **`DynamicAddressResolver`** (`*/5`) | `nginx conf.d/ip_restriction`, fail2ban `ignoreip`, règles iptables user, `allow.p2p` | `DynamicAddressResolver.bsh` → `MySB_SecurityRules refresh --users` |
| **Self-update** (nightly) | refresh complet `/opt/MySB` depuis GitHub (churn filemode) | `MySB_GitHubRepoUpdate` |

**Preuve live** : `~user-f/.rTorrent_inserted_new.sh` mtime **`11:55`** (= boot), `sync_mode=2`,
zéro `BYPASS-` → la régénération a bien tout écrasé au dernier restart. **Cette section est
la source de vérité de l'ADR KoBox** : tout comportement personnalisable **doit** être
DB/config-backed ; jamais une édition post-rendu d'un fichier généré.

## 7. Métriques opérationnelles (snapshot 2026-07-23)

- **Système** : load `0.40` / 4 vCPU ; RAM `1.1 G / 15 G` ; disque `2.2 T / 3.6 T` (64 %,
  1.3 T libre).
- **Torrents actifs par user** (DB) : user-a 1594, user-b 988, user-e 560, user-f 477, user-c 308,
  user-g 224, user-d 51, user-h 27 (**total 4283**).
- **Disque par user** (audit du même jour 2026-07-23, cohérent) : user-f 365 G, user-d 276 G,
  user-h 158 G, user-e 147 G, user-b 136 G, user-a 132 G, user-c 71 G, user-g 30 G.
- **Quota** : 412 Gb **soft** uniforme, **aucune limite hard** appliquée.

## 8. Écarts vs feature list de the owner (HANDOFF.md)

**Présent & fonctionnel** : ruTorrent + plugins, rTorrent 0.9.8 (compilé), nginx, sFTP chroot,
Postfix relay (stunnel `127.0.0.1:23000`, sasl), Seedbox-Manager, Cakebox, ShellInABox, Webmin,
OpenVPN ×3 (TUN/TAP, avec/sans GW), Samba, NFS, PeerGuardian, DNScrypt + Bind cache,
Let's Encrypt (**cert OK jusqu'au 26 août 2026**), Fail2ban, portail MySB, **cert SSL par
tracker** (46 trackers privés), whitelist, restrict IP dyndns, langue FR.

**Outils / features NON utilisés (preuves) — le levier de réduction de scope KoBox v1** :

| Feature | Statut | Preuve (2026-07-23) | Reco v1 |
|---|---|---|---|
| **Docker** | inutilisé | **0 container, 0 image**, bridges `docker0/br-frontend/br-backend` DOWN | **Drop** |
| **Plex / Tautulli** | absent | non installé (ni paquet, ni `/var/lib/plexmediaserver`) | **Drop** |
| **Billing / renting** | inutilisé | `tracking_rent_*` = **0 ligne** (cron `PaymentReminder` tourne dans le vide) | **Drop** |
| **Minio** | cassé | service **`failed` depuis 10 h** ; 9 lignes config mais non fonctionnel | **Drop** (ou fix si voulu) |
| **port_forwarding** | inutilisé | `port_forwarding` / `_addresses` = 0 ligne | **Drop** |
| **Samba** | idle | **0 session active** (`smbstatus` vide) ; config `[homes]` présente | Confirmer the owner |
| **OpenVPN** | idle | **0 client connecté** (`ipp.txt` vide, status 0 client) ; profils distribués | Confirmer the owner |
| **ShellInABox** | idle | écoute `127.0.0.1:4200` ; shell web (risque sécu) — usage non mesuré | Confirmer / **Drop** |
| **Cakebox-Light** | idle | écoute `:81` ; usage non prouvé (logs peu fiables) | Confirmer the owner |
| **Seedbox-Manager** | idle | binaire setuid présent ; usage non prouvé | Confirmer the owner |
| **Webmin** | peu utilisé | 1 login récent dans les logs ; panneau admin lourd | Confirmer / Drop |
| **NextCloud** | installé | `NextCloud_db` + `/opt/MySB/web/apps/nc` présents ; usage réel non mesuré | Confirmer the owner |
| **NetData** | actif | monitoring (nice-to-have) | Optionnel |

> ⚠️ **Fiabilité** : le signal « hits nginx » est **peu fiable** (`access_log off` sur beaucoup
> de locations du portail) — j'ai donc écarté ce critère et me suis appuyé sur des preuves dures
> (lignes DB, état service, connexions actives, paquets installés). ruTorrent est évidemment
> utilisé (4283 torrents) malgré 0 hit loggé.

**Confirmé utilisé** : rTorrent/ruTorrent (4283 torrents), trackers + certs (46 privés),
PeerGuardian, DNScrypt + Bind, Fail2ban, Let's Encrypt, Postfix, portail MySB, sFTP chroot,
quota (soft), **NFS** (exports `user-a`+`user-b` actifs, 2 montages `:2049` live).

**Hardening manquant** (wishlist HANDOFF) : pas de hard quota, pas de tc/HTB per-user (posé
puis retiré le 2026-07-23), pas de règle fail2ban « publickey flood ».

## 9. Recommandations pour l'archi cible KoBox

Ce que la **prod** révèle et qu'on aurait raté en lisant juste le code :

1. **Le bus `commands` est vide en régime permanent** (0 ligne) → c'est un dispatch
   événementiel court, pas une file persistante. KoBox : un **appel use-case synchrone** ou
   un job court suffit — **pas besoin d'infra de queue lourde** (Redis/RabbitMQ). Confirme la
   reco « worker root + jobs typés » sans sur-ingénierie.
2. **Couplage implicite n°1 : identité quadruplée.** KoBox doit avoir **un seul agrégat
   `SeedboxUser`** et **un seul store** ; la couture MariaDB/OS/Wolf/sqlite est le piège de
   migration principal.
3. **Deux plans de données par design** (contrôle central MariaDB + synchro sqlite/user).
   Recommandation : **unifier en un SQLite** avec schéma scoping par user ; garder la synchro
   comme *bounded context* mais pas comme datastore séparé. Le sqlite/user est un **seam
   Strangler** propre (KoBox peut posséder « sync » sans toucher au reste).
4. **ADR « hooks post-install persistants » — désormais chiffré** : 2 patches DB survivent,
   2 patches fichiers meurent (§5). Règle KoBox : **tout comportement user = colonne DB ou
   `user-hooks.d/` sourcé après rendu**, jamais une édition de fichier généré. Convertir les
   2 patches fichiers survivants en flags (`allow_public_tracker`, `sync_disabled`) + un
   early-exit natif pour les adds XMLRPC.
5. **Seams de migration Strangler identifiés** : (a) sqlite Sync par user, (b) fichiers nginx
   `upstream/` + `rpc/` par user, (c) `sudoers.d/MySB_<user>` par user — trois points où KoBox
   peut posséder « provisioning user » en écrivant les mêmes rows/fichiers pendant la
   coexistence avec MySB.
6. **Sécurité = argument fort du redesign** : l'escalade root all-users est **live** (§4).
   Le worker root typé de KoBox ferme un trou réel, pas seulement théorique.
7. **Ressources confirmées amples** (prochain serveur **identique** : 15 GiO / 4 vCPU à load
   0.4) → décision **TypeScript** verrouillée, aucune pression de footprint (voir ADR perf
   dans `docs/AUDIT.md`).
8. **Scope v1 réduit par la prod** : **Billing droppable** (inutilisé) ; **Minio** à
   questionner (mort) ; Plex/NextCloud à confirmer avec the owner. Chaque drop réduit la surface.

---

## ⚠️ À remonter à the maintainer (hors périmètre audit)

- **⚠️ Escalade root LIVE pour les 8 users** : `NOPASSWD bash ~/.rTorrent_tasks.sh*` +
  `www-data … ApplyConfig.bsh*` + `.check_annoncers 0666`. N'importe quel user (user-h
  inclus) peut devenir root **maintenant**. Inhérent à MySB (pas une misconfig) → **non
  corrigé** (règle read-only). À garder en tête tant que la box tourne.
- **Drift opérationnel user-f (non corrigé, read-only)** : `sync_mode` revenu à **2**
  (synchro NAS involontaire) **et** les 2 bypass `~/.rTorrent_inserted_new.sh` **disparus**
  depuis le restart de 11:55 → les adds Radarr/Sonarr de user-f peuvent crasher rtorrent et
  les trackers publics sont rejetés. Ré-appliquer via `project_seedbox_recovery_checklist.md`
  si souhaité.
- **Minio `failed` depuis 10 h** — à investiguer ou désactiver.
- **Non-urgent** : cert Let's Encrypt OK (26 août 2026, renew cron actif) ; disque 64 %,
  RAM/CPU au repos ; kernel/OS EOL (connu).

---

## Annexe — méthode

7 batches SSH read-only (`sshpass -e`, sortie `tee` en scratchpad local éphémère), password
sudo passé via env `printf %q` (jamais tee'd ni committé). **Aucun fichier créé côté seedbox**
(`/tmp/kobox-audit-*` inexistant, vérifié batch 7). Dumps locaux :
`…/scratchpad/prod-batch{1..7}-*.txt` (éphémères).
