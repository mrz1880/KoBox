# KoBox — Brief d'implémentation Phase 7 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à la **Phase 7** du
> rewrite KoBox : **migration des données prod & cutover**. C'est la tranche qui fait
> passer les 8 utilisateurs de the owner du legacy MySB (MariaDB + fichiers générés) à
> KoBox (SQLite + état désiré), **sans perte et de façon réversible**. Autonomie, TDD.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 7 de KoBox — Migration & Cutover**. Les Phases 0-6 sont
mergées sur `main` (vérifie `git log`/`gh pr list`). KoBox est fonctionnellement complet
(users, torrents, trackers/blocklists, sécurité/fair-use, installation, ops, **portail +
auth applicative**) et 100 % vert (unit+component+contract, integration Debian 12, E2E
conteneur). Il ne **tourne pas encore en prod** : cette phase importe l'état réel et bascule.

**C'est la seule tranche qui LIT la prod** (read-only d'abord) et qui, à la toute fin et
**seulement sur validation explicite de the owner**, écrit sur la vraie seedbox. Zéro
big-bang : coexistence, dry-run, rollback documenté.

### 0. État au démarrage (lis d'abord la mémoire projet)

- Branche principale = `main`. Phases 0-6 mergées.
- La Phase 6 a livré : portail SSR non-root (`kobox-portal`, Fastify) derrière nginx `:8189`,
  auth applicative (`portal_credentials`/`portal_sessions`/`login_attempts`, hash sha512-crypt
  partagé avec le compte système, CSRF, lockout, jail fail2ban `kobox-portal`), écrans admin
  + user, **SCGI par user** (`/RPC-<USER>` rendus dans `/etc/nginx/kobox.d/`), extras
  vendored (NFS/Samba/ShellInABox), `set-fair-use-override`, `set-samba-password`.
  DB partagée `/var/lib/kobox` `2770 root:kobox-portal` + `UMask=0007`.
- **Dette explicitement laissée à la Phase 7-** :
  1. **CRL easy-rsa** : `delete-user` retire le matériel client mais pas de révocation CRL
     (reportée de la Phase 6). À livrer ici ou en petite tranche dédiée.
  2. Webmin/Seedbox-Manager/Cakebox : liés/iframés mais pas encore composants d'install
     dédiés (si the owner les garde — cf. §7 AUDIT « scope v1 figé »).
  3. Pin ruTorrent officiel : process documenté (`docs/OPS.md`), pin à arrêter avec the owner.
  4. **Durcissement portail (revue Phase 6, non bloquant)** : (a) composition dédiée au
     portail qui n'instancie **pas** le `JobWorker` ni les adapters privilégiés — la
     frontière §3.5 est aujourd'hui tenue par l'interface `PortalServerDeps` (sous-ensemble
     non-privilégié) + le process non-root, pas par ce que le process construit ;
     (b) `EnvironmentFile` propre au portail (aujourd'hui il partage `worker.env`, qui porte
     `KOBOX_IBLOCKLIST_PIN`/`KOBOX_DISCORD_WEBHOOK`/`KOBOX_NTFY_URL` qu'il n'utilise pas) ;
     (c) `ProtectSystem=strict` + `ReadWritePaths=/var/lib/kobox` sur l'unité (écarté en
     Phase 6 car l'E2E d'install pose la DB sous `/tmp` — à régler avec une DB hors `/tmp`).

### 1. Lis d'abord (obligatoire)

1. `docs/AUDIT.md` — **§6 (le strangler & « Done par phase »)**, **§9 recommandations**,
   et surtout `docs/PROD-INSPECTION.md` **en entier** : c'est la cartographie read-only de
   la prod (schéma MariaDB 27 tables, identité **quadruplée** MariaDB/OS/Wolf/sqlite-sync,
   ports SCGI 51101→51117, quotas, patches survivants, cycle de régénération).
2. `docs/PROD-INSPECTION.md §3` (schémas DB) + **§5** (patches DB survivent / fichiers
   meurent — 2 patches fichiers à convertir en flags : `allow_public_tracker`,
   `sync_disabled`) + **§6** (déclencheurs de régénération).
3. `kobox/src/infrastructure/persistence/schema.ts` — le schéma cible SQLite ; mappe
   chaque table prod utile dessus.
4. `HANDOFF.md` (git-ignoré, identifiants prod) — **le seul accès prod**, read-only.

### 2. Décisions VERROUILLÉES (héritées)

- TS strict, `any` interdit, `readonly` ctor-only, optional chaining. Hexagonal : la
  migration vit dans `application/migration/` + un adaptateur `infrastructure/` qui LIT
  MariaDB ; le domaine ne connaît que des ports. Zod à la frontière d'import.
- **Un seul agrégat `SeedboxUser`, un seul store SQLite** : la migration résout la couture
  d'identité quadruplée (§9.2). Idempotente + ré-entrante + dry-run par défaut.
- État désiré déclaratif : après import des **données**, KoBox **régénère** tous les
  fichiers (nginx par-user, `.rtorrent.rc`, firewall, exports, profils VPN) — on n'importe
  jamais un fichier généré du legacy, on importe la donnée qui le produit.

### 3. Périmètre Phase 7 — EXACT

**DANS le périmètre** :
- **Lecteur prod read-only** : un adaptateur `MysbSourcePort` qui lit MariaDB `MySB_db`
  (users, users_rtorrent_cfg, users_addresses, trackers_list(+_ipv4), blocklists, torrents)
  et les sqlite `~/db/<user>.sq3` (categories/sync_mode) — via un dump fourni, **jamais**
  une connexion live non sollicitée. Fixtures neutres pour les tests (repo public).
- **Use case `ImportFromMysb`** : mappe chaque ligne prod → VO/agrégat KoBox, écrit via
  les repos existants, **dédupliqué et ré-entrant** (re-run = no-op). Rapport détaillé
  (importés/ignorés/conflits). Convertit les 2 patches fichiers survivants en flags DB.
- **`kobox migrate-from-mysb --dump <dir> [--dry-run]`** : dry-run par défaut, diff lisible ;
  `--apply` écrit. Mots de passe : **impossible de récupérer le cleartext** (MySB stocke
  `varchar(32)`) → générer un mot de passe temporaire par user + mail de reset (outbox), OU
  forcer un reset au premier login. Décider avec the owner.
- **Plan de cutover documenté** (`docs/CUTOVER.md`) : ordre exact (geler MySB → dump →
  import dry-run → revue → import → `kobox install` sur la cible → régénération → smoke →
  bascule DNS/port → fenêtre de rollback). **Coexistence** : KoBox sur `/opt/kobox`, MySB
  sur `/opt/MySB` ; même port `:8189` = bascule atomique nginx (un seul actif à la fois).
- **CRL easy-rsa** (dette #1) : révocation à la suppression user + `crl.pem` publié dans les
  confs serveur OpenVPN + hook de reload.
- **Pyramide complète** : unit (mappers prod→VO, invariants de dédup), component
  (`ImportFromMysb` avec fake source + repos in-memory), integration (import vs vraie
  SQLite depuis un dump fixture), E2E conteneur : dump fixture → `migrate-from-mysb --apply`
  → `kobox install` → stack verte → un user importé se connecte au portail, voit ruTorrent,
  télécharge son `.ovpn`.

**HORS périmètre (défère)** : Billing (hors-scope v1, `tracking_rent_*` = 0 ligne) ;
refonte graphique ; toute écriture sur la prod sans validation explicite de the owner.

### 4. Méthode (identique Phases 0-6)

Branche `feature/phase7-migration-cutover` depuis `main`. Un commit par unité,
conventional-commits (anglais) + `Co-Authored-By`. Pour chaque unité : TDD (red→green→
refactor) puis `verification-before-completion` (lint + typecheck + coverage + build +
integration + E2E conteneur). Fin de phase : `requesting-code-review`, PR draft (<200 mots,
sans lien de session), ne pas merger sans validation.

### 5. Garde-fous (STOP si franchi)

1. **NE JAMAIS écrire sur la seedbox de prod sans un GO explicite de the owner.** Le dump
   d'import est fourni/copié ; la lecture live MariaDB est read-only et sollicitée.
2. **NE JAMAIS toucher le legacy MySB** en dehors du dump read-only.
3. Repo PUBLIC — zéro identité prod/perso : **fixtures neutres** pour tous les tests ; le
   hook pre-commit scanne les chemins stagés ; `HANDOFF.md` git-ignoré.
4. Budget CI GitHub Free : qualité verrouillée en local (⚠️ `pnpm ... | tail` masque le
   code retour en zsh — `cd kobox` avant `pnpm vitest`).
5. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ; exec+string
   shell interdit ; aucun secret (mots de passe temporaires) dans la DB jobs ni les logs.
6. Toute action irréversible (écriture prod, bascule DNS, force-push) → demande d'abord.

### 6. Dette / points d'attention connus

- **Identité quadruplée** (§9.2 PROD-INSPECTION) = le piège n°1 : un seul `SeedboxUser`,
  réconcilier MariaDB `users` ⟷ compte OS ⟷ user Wolf ⟷ sqlite-sync sans doublon.
- **DB survit, fichier meurt** (§5) : importe la **donnée** (flags `allow_public_tracker`,
  `sync_disabled`), pas les fichiers générés ; laisse KoBox régénérer.
- **Ports SCGI** : la prod alloue 51101→51117 séquentiels ; l'import doit préserver les
  ports existants (le VO `Port`/`PortAllocator` doit accepter un import explicite pour ne
  pas re-router un user vers un autre port et casser ses torrents en cours).
- **Mots de passe non récupérables** : décision the owner (reset au 1er login vs mot de
  passe temporaire mailé). Le portail Phase 6 a déjà le canal (`change-password`, outbox).
- Quand tu as terminé, écris le prompt de la prochaine session (hardening post-cutover /
  backlog v1.1 : Webmin/SM/Cakebox composants, VPN client NordVPN #47, etc.) avec le
  document lié, comme pour ce brief.
