# KoBox — Brief d'implémentation Phase 0 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à implémenter la **Phase 0**
> du rewrite KoBox, en autonomie, méthodiquement, en respectant nos standards de qualité.
> Tu peux lancer la session en collant la section **« Prompt »** ci-dessous — elle référence ce
> fichier et les docs d'audit.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 0 de KoBox** telle que définie dans `docs/AUDIT.md` §6, en
**autonomie totale**, en **TDD**, **un commit par unité de travail**, **une PR pour la phase**.
Ne re-débats aucune décision d'archi déjà figée : elles sont dans `docs/AUDIT.md`. Si — et
seulement si — tu rencontres une bifurcation réelle non couverte par les docs, pose UNE question
ciblée, sinon avance.

### 1. Lis d'abord, dans l'ordre (obligatoire avant toute action)

1. `HANDOFF.md` — contexte projet + **contraintes prod (NE JAMAIS toucher la seedbox)**.
2. `docs/AUDIT.md` — la référence. En particulier : §2 (bounded contexts, Value Objects), §3
   (archi hexagonale, choix stack, §3.4 arbo cible, §3.5 worker root/jobs typés, §3.7
   observabilité), §4 (stratégie de test), §5 (anti-patterns à NE PAS reproduire), §6 (plan de
   migration, **Phase 0**), §7 (scope figé).
3. `docs/PROD-INSPECTION.md` — le **modèle de données réel** (MariaDB 27 tables, table `users` et
   ses colonnes, ports SCGI 51101→, quota 412 G, sqlite Sync par user). C'est la source de vérité
   pour le schéma SQLite cible et les invariants.
4. `~/.claude/CLAUDE.md` (standards de code globaux d'the maintainer) — appliqués sans exception.

Invoque le skill **`writing-plans`** pour transformer ce brief en plan d'exécution avant de coder.

### 2. Décisions VERROUILLÉES (ne pas re-trancher — venir de l'audit)

- **Langage** : **TypeScript strict** (Node LTS). `any` **interdit**. Champs assignés au seul
  constructeur → `readonly`. Optional chaining préféré.
- **Archi** : hexagonale — `domain / application / infrastructure / interfaces`. Le **domaine ne
  dépend de rien** (ni framework, ni I/O). Ports & adapters. Arbo = `docs/AUDIT.md §3.4`, sous un
  dossier **`kobox/`** à la racine du repo (coexiste avec le legacy MySB — stratégie strangler ;
  **ne touche pas** `install/ web/ inc/ bin/ scripts/ templates/`).
- **DB** : **SQLite** unique (mode WAL), accès via **Drizzle ORM** + migrations `drizzle-kit`.
- **Tests** : **Vitest** ; property-based **fast-check** ; intégration via conteneur **Debian 12
  privilégié** (testcontainers ou script docker) ; E2E idem.
- **Validation frontière** : **Zod** (parse → Value Object ; « parse, don't validate »).
- **Logs** : structurés JSON (**pino**). CLI : une lib typée (ex. **clipanion** ou **commander**).
- Boring tech first. Bus factor 1 : chaque abstraction doit se justifier « je maintiens ça seul
  dans 3 ans ». Pas d'abstraction spéculative.

### 3. Périmètre Phase 0 — EXACT (bounded context : User Management, en vertical slice)

**DANS le périmètre** :

- **Scaffold & toolchain** : projet `kobox/` TS strict (`tsconfig` strict, `noUncheckedIndexedAccess`,
  etc.), ESLint (règle `no-any`, `prefer-optional-chain`, `readonly`), Vitest, Drizzle+SQLite,
  Zod, pino, fast-check. Scripts `lint / typecheck / test / test:int / test:e2e / build`.
- **Env de dev/test** : `.devcontainer` ou `docker/` avec une image **Debian 12** privilégiée
  (`jrei/systemd-debian:12` ou équiv.) pour tourner les adapters système & l'E2E ; un `Makefile`
  (`up / shell / test-int / e2e / down`) ; `docs/DEV.md` (comment on développe en local).
- **`domain/user/`** : agrégat **`SeedboxUser`** (immutable ; mutations via méthodes qui
  retournent un nouvel état et/ou publient un event). **Value Objects** (invariants encapsulés,
  immutables, égalité par valeur) : `UserId`, `Username` (lowercase, charset, ≤32, noms réservés
  root/plex/ftp), `EmailAddress`, `Quota` (unité interne cohérente, ≥0, `maxSettable = used + free`
  — cf. bug legacy #72), `AccountType` (normal/plex), `ScgiPort`/`RtorrentPort`/`ProxyPort`
  (`Port` 1-65535, unicité, allocation **atomique** — pas de `max()+1` racé), `UserStatus`
  (active/suspended). **Ports** (interfaces du domaine) : `UserRepository`, `SystemAccountPort`,
  `QuotaPort`, `SftpPort`, `NotificationPort`.
- **`application/user/`** : use cases **`CreateUser`, `DeleteUser`, `ChangePassword`,
  `SuspendUser`, `ResumeUser`** (orchestrent les ports, zéro I/O direct). `SuspendUser`/`ResumeUser`
  = **réversible & idempotent**, effet via ports (coupe SSH/SFTP/rtorrent), **sans** supprimer
  données/compte (cf. `AUDIT.md §6` et le cas user-h). Germe du **job typé** (enum d'action fermé
  + payload Zod) pour la frontière web-non-privilégié → worker-root.
- **`infrastructure/`** : `persistence/` repo SQLite (Drizzle) + migrations (schéma dérivé de
  `PROD-INSPECTION.md`) ; `system/` adapters réels via `execFile` typé (`SystemAccountAdapter`
  useradd/usermod/userdel, `QuotaAdapter`, `SftpAdapter`) **+ leurs fakes in-memory** ;
  `NotificationPort` : interface + un adapter stub (console) — les vrais canaux ntfy/email/discord
  viendront plus tard, poser l'interface suffit. Instrumentation fondation : logging structuré +
  un `HealthProbePort` (process+socket) minimal.
- **`interfaces/cli/`** : `kobox create-user | delete-user | change-password | suspend-user |
  resume-user`, + `kobox doctor` (health). **`interfaces/worker/`** : un consumer root **minimal**
  qui dépile un job typé et exécute via `infrastructure/system` (prouve la couture §3.5).
- **CI GitHub Actions** : `lint + typecheck + unit + component` à chaque push ; `integration + e2e`
  (Debian 12 privilégié) sur PR. Cibles temps de `AUDIT.md §4`.
- **Pyramide de tests complète** sur la tranche (voir §5 ci-dessous).

**HORS périmètre Phase 0** (défère, ne commence pas) : fair-use evaluator / métering / throttle
(Phase 3), portail HTTP/SSR (Phase 6), contextes Torrent/Tracker/Security, Prometheus/Grafana,
les canaux d'alerte réels. Poser les **interfaces** qui les anticipent est OK ; les **implémenter**
non.

### 4. Standards de qualité NON-NÉGOCIABLES

- **DDD tactique** : aucun primitif nu ne traverse une frontière de fonction du domaine —
  `int/string/bool` bruts uniquement à la frontière I/O. Invariants **dans** les VO/entités.
- **Immutabilité par défaut** : VOs et entités immutables ; `readonly` partout où c'est
  constructeur-only ; mutations explicites via méthodes qui retournent un nouvel état.
- **Domaine pur** : `domain/` n'importe ni Drizzle, ni Node `fs`/`child_process`, ni pino. Tout
  passe par des ports. Le framework vit en `infrastructure`/`interfaces`.
- **GoF pragmatique** : un pattern seulement s'il clarifie. Composition > héritage. Lisibilité
  d'abord. Pas de pattern pour cocher une case.
- **Commentaires** : minimum — seulement le « pourquoi » non-évident (workaround, contrainte).
  Jamais le « what ».
- **Sécurité** (leçons `AUDIT.md §5.1`) : aucun argument shell arbitraire (pas d'interpolation
  dans un shell ; `execFile` avec argv, jamais `exec`+string). Aucun `NOPASSWD` wildcard. Secrets
  jamais loggés ni commités. Valide `Username`/paths comme VO avant tout appel système.
- **Anti-régen destructive** (`AUDIT.md §5.2`) : état désiré déclaratif, rendu **idempotent**,
  golden-tested ; ne jamais écraser un fichier potentiellement édité sans merge explicite.

### 5. Stratégie de test (par unité — cf. `AUDIT.md §4`)

- **Unit** (Vitest + fast-check) : chaque VO (property-based sur `Port` range/unicité, `Quota`
  conversions & `maxSettable`, `Username` charset), domain services, invariants de `SeedboxUser`.
- **Component** : chaque use case avec **fakes** des ports (jamais la vraie machine).
- **Integration** : repo vs **vraie SQLite** temporaire ; adapters système vs **conteneur Debian
  12** (useradd/quota réels) ; golden files pour tout rendu de conf.
- **Contract** : schémas Zod des commandes CLI et des **payloads de jobs** (web↔worker), diff en CI.
- **E2E** (Debian 12 privilégié, high-signal) : `create-user` → compte + quota + chroot vérifiés ;
  `suspend-user` → SSH/FTP/rtorrent coupés ; `resume-user` → tout restauré.
- Nommage **BDD-ish** (`should_reject_username_when_reserved`, given/when/then). **Test Data
  Builders** (`aUser().withQuota(...).build()`), pas de setup inline. **Mocks vs fakes vs stubs**
  selon le cas (fakes pour les ports système ; mocks réservés à la vérification d'interaction).
  Cible **>85 % lignes sur domain + application** — mais l'**expressivité** prime la couverture.

### 6. Méthode (rigueur d'exécution)

- Invoque **`writing-plans`** → produis le plan, découpé en **unités de travail** livrables
  indépendamment (une unité = un incrément testé : ex. « VO `Port` + allocateur atomique + tests »).
- Pour **chaque** unité : invoque **`test-driven-development`** et suis-le **exactement**
  (red → green → refactor). Test d'abord, toujours.
- Avant de déclarer une unité « faite » : invoque **`verification-before-completion`** (preuve
  d'exécution : `pnpm test` vert, `typecheck` vert, sortie réelle — pas d'assertion sans preuve).
- Sur tout bug/échec : invoque **`systematic-debugging`** (pas de fix à l'aveugle).
- **Un commit par unité** : messages en anglais, style conventional-commits (`feat: / fix: /
  test: / chore: / refactor:`), corps expliquant le **why**, et se terminant par la ligne
  `Co-Authored-By` habituelle. Branche : `feature/phase0-user-management` (depuis la branche qui
  contient les docs d'audit).
- En fin de phase : invoque **`requesting-code-review`**, corrige, puis ouvre **UNE PR draft**
  `feature/phase0-user-management → <branche de base>` (titre + corps <200 mots). Ne merge pas.

### 7. Critères de DONE (Phase 0)

- E2E **vert** sur fresh Debian 12 : create → suspend → resume, avec quota + chroot vérifiés.
- Toute la pyramide verte ; couverture domain+application **>85 %** lignes.
- CI GitHub Actions verte (lint/typecheck/unit/component + integration/e2e).
- `docs/DEV.md` écrit (comment développer/tester en local Docker+VM).
- PR draft ouverte + un résumé chat <200 mots (reco, ce qui reste, prochaine tranche).

### 8. Garde-fous (STOP si franchi)

1. **NE TOUCHE PAS la seedbox de prod** (cf. `HANDOFF.md`). Tout dev/test en **local Docker + VM**.
2. **NE MODIFIE PAS le code legacy MySB** (`install/ web/ inc/ bin/ scripts/ templates/ upgrade/`) —
   KoBox est du **code neuf** sous `kobox/`.
3. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ; `exec`+string shell
   interdit ; secret loggé/commité interdit.
4. Pas de dépendance lourde non justifiée (bus factor 1). Pas de queue externe (Redis/…) — la file
   de jobs est en SQLite (cf. `AUDIT.md §9 prod : bus vide en régime permanent`).
5. Si tu hésites sur quelque chose d'**irréversible** (force-push, suppression, action réseau
   sortante) → **demande d'abord**.

---

## Notes pour the maintainer (hors prompt)

- La branche d'audit `audit/initial-plan` (PR #1) contient toutes les décisions. Merge-la (ou
  base la branche Phase 0 dessus) pour que la session ait `docs/*` sous la main.
- Reste ouvert : rien de bloquant — le scope v1 est figé à 100 %.
