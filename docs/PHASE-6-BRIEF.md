# KoBox — Brief d'implémentation Phase 6 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à la **Phase 6** du rewrite
> KoBox (bounded context **Portal & Access**), en autonomie, en TDD,
> dans la continuité des Phases 0-5.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 6 de KoBox — Portal & Access** telle que cadrée dans
`docs/AUDIT.md §1.6 + §3.3 + §5.5 + §6 (phase 6)`, en réutilisant les fondations des
Phases 0-5 **toutes mergées sur `main`** (vérifie ; sinon la Phase 5 est en PR draft).
**Autonomie totale, TDD strict, un commit par unité de travail, une PR draft pour la
phase.** Ne re-débats aucune décision d'archi figée dans `docs/AUDIT.md`. **C'est la
dernière tranche du strangler** : le portail SSR remplace le thème Wolf CMS + l'admin
legacy, l'auth applicative remplace le Basic Auth « un seul mot de passe pour tous »,
et ruTorrent reste iframé derrière le même nginx.

### 0. État au démarrage (mémo — lis d'abord la mémoire projet)

- **La branche principale est `main`.** Phases 0-5 mergées — vérifie `git log`/`gh pr list`.
- La Phase 5 a livré : contexte `domain/maintenance/` (scheduler cron.d déclaratif —
  parité avec le cron 26 lignes prod, entrées = enqueue de jobs typés dédupliqués),
  outbox mail durable (`mails` + SendMails, backoff 5m/30m/2h/12h, canal email branché
  dessus), `kobox configure-mail-relay` (sasl_passwd 0600 + postconf, direct-only),
  backups TTL (`run-backup`/`restore-backup`, `.backup` SQLite online + tar configs),
  **upgrades transactionnels** (`kobox upgrade --to <ref>` : worktree stagé →
  build → backup → migrate → flip atomique `/opt/kobox/current` → verify worker,
  rollback auto + `--rollback`, ledger `releases`), composant `letsencrypt`
  (certbot webroot via bloc ACME :80, hook deploy nginx, certbot.timer ; pebble en
  E2E), **pgl retiré → ipset** (`kobox-bl`, staging+swap atomique, règle DROP dans
  INPUT, restore au boot ; `allow.p2p`/`pgl_in`/pglcmd supprimés — la confiance
  membre vit dans les accepts `kobox:trusted:*` du firewall), `docs/OPS.md`.
- **Dette explicitement laissée à la Phase 6-** :
  1. **Vendored extras** (déférés de la Phase 5) : Samba/**NFS (KEEP prod : actif)**,
     ShellInABox durci localhost, Webmin/Seedbox-Manager/Cakebox en composants simples.
  2. **Révocation VPN** : delete-user retire le matériel client mais pas de CRL easy-rsa.
  3. ruTorrent : config **par user** + wiring SCGI par user dans nginx (les upstreams
     `/RPC-user` du prod) — volontairement laissé à la tranche portail/auth.
  4. htpasswd nginx : vide (deny-all) depuis la Phase 4 — c'est CETTE phase qui le
     remplace par l'auth applicative.
  5. Pin ruTorrent officiel : process documenté dans `docs/OPS.md`, pin à choisir.

### 1. Lis d'abord, dans l'ordre (obligatoire avant toute action)

1. `docs/AUDIT.md` — **§1.6 Portal & Access** (langage ubiquitaire, capacités admin),
   **§3.3 SSR monolithe modulaire** (décision framework), **§5.5 défauts du portail
   legacy** (Basic Auth partagé, injections, CSRF, session), §6 phase 6 ; **§7 « le
   portail garde-t-il son URL/design ? »** et `docs/PROD-INSPECTION.md §2`
   (`https://seedbox.example:8189` + `/ru` + upstreams SCGI par user en RPC majuscule).
2. `docs/UI-AUDIT.md` — l'inventaire des écrans legacy (parité fonctionnelle à trier
   KEEP/DROP avec l'owner au plan).
3. `docs/DEV.md` + `docs/OPS.md` — conteneur/VM, pièges E2E, runbooks.
4. `kobox/` — réutilise : use cases existants (l'HTTP ne fait QUE les appeler ou
   enfiler des jobs — aucun accès direct aux adapters privilégiés), queue typée,
   `OpensslPasswordHasher`, `SqliteMailOutbox` (mails de bienvenue), rendus nginx.
5. `~/.claude/CLAUDE.md` — standards de code (appliqués sans exception).

Invoque **`writing-plans`** avant de coder, puis **`test-driven-development`** pour
chaque unité, **`systematic-debugging`** sur tout bug, **`requesting-code-review`** en
fin de phase.

### 2. Décisions VERROUILLÉES (héritées — ne pas re-trancher)

- TypeScript strict, `any` interdit, `readonly` constructeur-only, optional chaining.
- Hexagonal : le portail vit dans `interfaces/http/` et **ne contourne jamais** les
  use cases ; le worker root reste l'unique exécutant privilégié (§3.5) — le portail
  tourne **non-root** et enfile des jobs.
- SSR monolithe modulaire (§3.3 — pas de SPA) ; SQLite unique + Drizzle ; Zod à la
  frontière HTTP ; sessions server-side ; CSRF sur toute mutation (anti-§5.5).
- URL/entrée stables pour l'owner : portail derrière nginx sur le port 8189 existant,
  ruTorrent iframé sous `/ru` (re-design du frontend libre, entrée identique).
- `execFile` argv only ; état désiré déclaratif + idempotent + golden-testé ; jamais
  de `>` sur un fichier édité.

### 3. Périmètre Phase 6 — EXACT

**DANS le périmètre** :
- **Auth applicative** : login/logout par user (hash Phase 0), sessions, rôles
  admin/user, remplacement du Basic Auth nginx (le htpasswd vide meurt ici) ;
  lockout/fail2ban sur le portail conservés.
- **Portail admin** : CRUD users (create/suspend/resume/delete/password → jobs),
  trackers & blocklists, adresses/DynDNS, fair-use (états, événements, override),
  santé services + registre composants, outbox mails, releases/upgrades (lecture).
- **Portail user** : mes infos/quota/usage, changement de mot de passe, mes accès
  (profils .ovpn à télécharger), ruTorrent iframé.
- **nginx par-user pour ruTorrent** : upstreams SCGI par user (parité `/RPC-user`),
  config ruTorrent par user — rendu déclaratif golden-testé + composant/scheduler
  déjà en place.
- **Vendored extras (dette #1)** : NFS/Samba d'abord (KEEP prod), ShellInABox
  localhost ; Webmin/Seedbox-Manager/Cakebox si le temps.
- **CRL easy-rsa (dette #2)** si le temps — sinon documenter et reporter.
- **Pyramide complète** : unit (VOs session/route guards), component (handlers avec
  fakes), golden (nginx par-user, pages critiques si templating), integration,
  E2E conteneur : login → créer un user via le portail → worker → stack verte →
  l'user se connecte, télécharge son .ovpn, voit ruTorrent.

**HORS périmètre (défère)** : migration des données prod / cutover (session dédiée
post-Phase 6), Billing (hors-scope v1), refonte graphique poussée (l'UX peut rester
sobre — parité d'abord).

### 4. Méthode (identique Phases 0-5)

- Branche `feature/phase6-portal-access` depuis `main`. **Un commit par unité**,
  conventional-commits (anglais) + `Co-Authored-By`.
- Pour chaque unité : `test-driven-development` (red→green→refactor), puis
  `verification-before-completion` (lint + typecheck + coverage + build + intégration
  + E2E conteneur) avant de déclarer « fait ».
- Fin de phase : `requesting-code-review`, corriger (`receiving-code-review`),
  **PR draft** → `main` (<200 mots, **sans lien de session**), ne pas merger sans
  validation.

### 5. Garde-fous (STOP si franchi)

1. **NE JAMAIS toucher la seedbox de prod.** Tout dev/test en local Docker + VM.
2. **NE JAMAIS toucher le legacy MySB** (lecture seule pour référence).
3. **Repo PUBLIC — zéro identité prod/perso** : fixtures neutres ; le hook pre-commit
   scanne tous les chemins stagés ; `HANDOFF.md` est git-ignoré.
4. **Budget CI GitHub Free** : qualité verrouillée en local (⚠️ `pnpm ... | tail`
   masque le code retour en zsh).
5. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ;
   `exec`+string shell interdit ; **aucun secret dans la DB jobs ni dans les logs**.
6. Toute action **irréversible** (force-push, suppression, réseau sortant réel) →
   **demande d'abord**.

### 6. Dette / points d'attention connus

- **Le piège n°1 de cette phase : refaire le §5.5.** Basic Auth partagé, SQL string
  interpolé, absence de CSRF, sessions en clair — chaque écran doit passer par les
  use cases et la frontière Zod ; le portail n'a AUCUN privilège (il enfile).
- Le bloc ACME `:80` et le vhost 8189 sont rendus par la Phase 5 — étends le rendu
  nginx (goldens) au lieu d'écrire un deuxième fichier.
- E2E : les suites partagent le conteneur — désactive tout ce que tu actives en
  afterAll ; fail2ban reste coupé pendant les tests ; le worker systemd draine en
  continu (stoppe-le pour observer des jobs pending).
- Quand tu as terminé, écris le prompt de la prochaine session (migration prod /
  cutover) avec le document lié, comme pour ce brief.
