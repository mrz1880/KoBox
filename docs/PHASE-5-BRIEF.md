# KoBox — Brief d'implémentation Phase 5 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à la **Phase 5** du rewrite
> KoBox (bounded context **Maintenance & Ops**), en autonomie, en TDD,
> dans la continuité des Phases 0-4.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 5 de KoBox — Maintenance & Ops** telle que cadrée dans
`docs/AUDIT.md §1.7 + §5.6 + §6 (phase 5)`, en réutilisant les fondations des Phases 0-4
**toutes mergées sur `main`** (vérifie ; sinon la Phase 4 est en PR draft). **Autonomie totale,
TDD strict, un commit par unité de travail, une PR draft pour la phase.** Ne re-débats aucune
décision d'archi figée dans `docs/AUDIT.md`. **C'est la tranche qui fait vivre une box
installée dans le temps** — scheduler, upgrades transactionnels, backups, outbox mail,
Let's Encrypt — et qui remplace le cron 26 lignes + `UpgradeMe`/`GitHubRepoUpdate` du legacy.

### 0. État au démarrage (mémo — lis d'abord la mémoire projet)

- **La branche principale est `main`.** Phases 0/1/2/3 mergées ; Phase 4 (Installation &
  Provisioning) en PR draft ou mergée — vérifie `git log`/`gh pr list`.
- La Phase 4 a livré : contexte `domain/installation/` (catalogue de composants ordonné par
  dépendances, plan **résumable**, préflight bloquant, registre `components` en DB),
  installeurs v1 (sshd durci gardé par `sshd -t`, nginx deny-by-default, rtorrent/ruTorrent
  vendored vérifié sha256, bind+dnscrypt, fail2ban, OpenVPN + **PKI easy-rsa EC** (`dh none`),
  Postfix loopback-only, quota tools, sysctl), `kobox install|install-status|uninstall`
  (idempotent, anti-CleanAll), `kobox-worker.service` + `kobox-firewall.service` (boot
  oneshot — dette Phase 3 soldée), `bootstrap/install.sh` (~45 lignes), chaînage
  create/delete-user → PKI client → `render-openvpn`, mode strict `KOBOX_STRICT_SERVICES`,
  E2E « Debian 12 vierge → bootstrap → stack verte → create-user via worker systemd ».
- **Dette explicitement laissée à la Phase 5** :
  1. **pgl/ipset** : pgl n'est pas packagé Debian 12 (le legacy vendorait des .deb Qt4) —
     composant `skipped` honnête. Décider avec l'owner : loader ipset natif KoBox
     (rend `allow.p2p`/blocklists effectifs au niveau kernel) ou abandon (l'enforcement
     rtorrent `ipv4_filter` couvre déjà le torrenting).
  2. **Pin ruTorrent** : `KOBOX_RUTORRENT_URL/SHA256` sans défaut embarqué — décider le pin
     officiel (et son processus de mise à jour = upgrades Phase 5).
  3. **Révocation VPN** : delete-user retire matériel + profils, mais pas de CRL easy-rsa.
  4. `/etc/resolv.conf` jamais touché par l'install (le legacy le clobberait §5.2) —
     documenter/outiller le basculement vers bind local en ops.
  5. Mineurs revue Phase 4 : voir la PR draft.

### 1. Lis d'abord, dans l'ordre (obligatoire avant toute action)

1. `docs/AUDIT.md` — **§1.7 Maintenance & Ops** (self-update, upgrades versionnés, revision
   & drift, backups TTL, cron + watchdog, outbox `mails` + relay Postfix, monitoring) ;
   **§5.6 leçons ops** (self-update git-reset destructif, reboot forcé mid-upgrade,
   migrations TRUNCATE, dispatch screen+busy-wait sans code retour, TLS désactivé) ;
   §6 phase 5.
2. `docs/PROD-INSPECTION.md` §2 — le **cron root 26 lignes** réel (fréquences par job) et le
   watchdog `MySB_jobs_check` ; c'est la parité à assurer avec le scheduler KoBox.
3. `docs/DEV.md` — conteneur/VM, pièges E2E des phases précédentes.
4. `kobox/` — réutilise : queue de jobs typée + `ChainHints`, `ComponentRegistry`,
   `PackagePort`/`SystemdPort`, `NotificationPort`, `EmailChannel` (sendmail),
   `ArtifactFetchPort` (téléchargements vérifiés), `Version` VO.
5. `~/.claude/CLAUDE.md` — standards de code (appliqués sans exception).

Invoque **`writing-plans`** avant de coder, puis **`test-driven-development`** pour chaque
unité, **`systematic-debugging`** sur tout bug, **`requesting-code-review`** en fin de phase.

### 2. Décisions VERROUILLÉES (héritées — ne pas re-trancher)

- TypeScript strict, `any` interdit, `readonly` constructeur-only, optional chaining.
- Hexagonal : contexte sous `kobox/src/domain/maintenance/` ; `domain` ne dépend de rien.
- SQLite unique (WAL) + Drizzle ; Zod à la frontière ; étends `JobType`/`jobPayloadSchemas`.
- `execFile` argv only ; état désiré déclaratif + idempotent + golden-testé ; **jamais** de
  `>` sur un fichier édité ; **upgrades transactionnels/versionnés** (§5.6 : jamais de
  `git reset --hard` sur soi-même, jamais de reboot forcé, codes retour propagés).
- Le scheduler KoBox remplace le cron legacy : les entrées enfilent des **jobs typés**
  existants (`renew-tracker-certs`, `update-blocklists`, `resolve-dyndns`,
  `evaluate-fair-use`…) — pas de nouvelles surfaces shell.

### 3. Périmètre Phase 5 — EXACT

**DANS le périmètre** :
- **Scheduler** : parité fonctionnelle avec le cron 26 lignes prod (fréquences §2
  PROD-INSPECTION) en rendu déclaratif (`/etc/cron.d/kobox` OU timers systemd — trancher au
  plan, golden-testé, installé par un composant `scheduler` ajouté au catalogue Phase 4) ;
  `CronSchedule` VO ; le watchdog legacy disparaît (systemd Restart= le remplace).
- **Outbox mail** : table `mails` + `SendMails` (retry, backoff, statut) via le relay
  Postfix ; réutilise `EmailChannel`/sendmail ; credentials SMTP relay (`postconf` +
  `sasl_passwd` chiffré/0600 — jamais en clair versionné).
- **Let's Encrypt** : composant `letsencrypt` (certbot standalone/webroot, hooks renew
  nginx), remplace le snakeoil Phase 4 quand un FQDN public existe (env-driven).
- **Upgrades** : `kobox upgrade` — `git fetch` + checkout **par tag/commit pinné** dans un
  arbre de travail séparé, `pnpm install+build`, migrations Drizzle, redémarrage worker —
  avec rollback (l'ancienne version reste bootable) ; anti-`GitHubRepoUpdate`.
- **Backups** : dump SQLite (`.backup`) + configs KoBox → rotation TTL (Backup-Manager
  legacy §1.7) ; restauration documentée et testée.
- **Vendored extras si le temps** (sinon Phase 6-) : Samba/NFS (KEEP prod : NFS actif),
  ShellInABox durci localhost, Webmin/Seedbox-Manager/Cakebox en composants simples.
- **Décision pgl/ipset** (dette #1) — si ipset retenu : composant + rendu + reload réel.
- **Pyramide complète** : unit (CronSchedule, plans d'upgrade), component (scheduler/outbox
  avec fakes), golden (cron.d/timers, hooks certbot), integration (conteneur), E2E :
  box installée → scheduler posé → un tick réel exécute les jobs → outbox part via
  Postfix local → backup/restore vert.

**HORS périmètre (défère)** : portail SSR + auth applicative (Phase 6), migration des
données prod / cutover (après Phase 6), Billing (hors-scope v1).

### 4. Méthode (identique Phases 0-4)

- Branche `feature/phase5-maintenance-ops` depuis `main`. **Un commit par unité**,
  conventional-commits (anglais) + `Co-Authored-By`.
- Pour chaque unité : `test-driven-development` (red→green→refactor), puis
  `verification-before-completion` (lint + typecheck + coverage + build + intégration + E2E
  conteneur) avant de déclarer « fait ».
- Fin de phase : `requesting-code-review`, corriger (`receiving-code-review`), **PR draft**
  → `main` (<200 mots, **sans lien de session**), ne pas merger sans validation.

### 5. Garde-fous (STOP si franchi)

1. **NE JAMAIS toucher la seedbox de prod.** Tout dev/test en local Docker + VM.
2. **NE JAMAIS toucher le legacy MySB** (lecture seule pour référence).
3. **Repo PUBLIC — zéro identité prod/perso** : fixtures neutres ; le hook pre-commit
   scanne tous les chemins stagés ; `HANDOFF.md` est git-ignoré.
4. **Budget CI GitHub Free** : qualité verrouillée en local (⚠️ `pnpm ... | tail` masque le
   code retour en zsh).
5. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ; `exec`+string
   shell interdit. apt/certbot réels : uniquement conteneur/VM ; certbot en E2E = serveur
   ACME fixture local (pebble) ou dry-run — **jamais** la prod Let's Encrypt.
6. Toute action **irréversible** (force-push, suppression, réseau sortant réel) →
   **demande d'abord**.

### 6. Dette / points d'attention connus

- **Le piège n°1 de cette phase : le self-update qui se scie la branche** (§5.6). Un upgrade
  rate → l'ancienne version doit redémarrer telle quelle (worktree versionné, symlink
  switch, jamais de mutation in-place de l'arbre qui tourne).
- Le scheduler doit **enfiler des jobs, pas exécuter** : le worker root reste l'unique
  exécutant privilégié (§3.5) ; un tick raté se rattrape au tick suivant (idempotence des
  jobs déjà acquise).
- E2E : les suites partagent le conteneur — toute unité/timer activé doit être désactivé en
  afterAll (leçon Phase 3/4) ; fail2ban reste coupé pendant les tests.
- Quand tu as terminé, écris le prompt de la prochaine session (Phase 6 — Portal & Access)
  avec le document lié, comme pour ce brief.
