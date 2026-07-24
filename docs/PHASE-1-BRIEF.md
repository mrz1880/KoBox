# KoBox — Brief d'implémentation Phase 1 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à la **Phase 1** du rewrite
> KoBox (bounded context **Torrent Lifecycle**), en autonomie, en TDD, dans la continuité de la
> Phase 0 déjà mergée sur `main`.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 1 de KoBox — Torrent Lifecycle** telle que cadrée dans
`docs/AUDIT.md §6` (phase 1) et en réutilisant les fondations posées en Phase 0 (mergée sur
`main`). **Autonomie totale, TDD strict, un commit par unité de travail, une PR draft pour la
phase.** Ne re-débats aucune décision d'archi figée dans `docs/AUDIT.md`.

### 1. Lis d'abord, dans l'ordre (obligatoire avant toute action)

1. `docs/AUDIT.md` — la référence (archi hexagonale §3, arbo cible §3.4, worker root/jobs typés
   §3.5, anti-patterns §5, plan de migration §6, **Torrent Lifecycle = §1.3 + phase 1**).
2. `docs/PROD-INSPECTION.md` — modèle de données réel (sqlite Sync par user, `sync_mode`, seam
   Strangler §5-6 : les 2 patches fichiers à convertir en flags DB `allow_public_tracker` /
   `sync_disabled` + early-exit natif pour les adds XMLRPC sans `.torrent`).
3. `docs/DEV.md` — comment développer/tester en local (Docker + VM).
4. `kobox/` — le code Phase 0 : réutilise l'archi, les VOs, les ports, les fakes, le worker,
   la file de jobs typée, les adapters `execFile`. **Étudie `SeedboxUser`, les ports, le
   `JobWorker` et le seam job avant d'écrire quoi que ce soit.**
5. `~/.claude/CLAUDE.md` — standards de code (appliqués sans exception).

Invoque le skill **`writing-plans`** pour transformer ce brief en plan d'exécution avant de coder,
puis **`test-driven-development`** pour chaque unité.

### 2. Décisions VERROUILLÉES (héritées de Phase 0 — ne pas re-trancher)

- **TypeScript strict**, `any` interdit, `readonly` constructeur-only, optional chaining.
- **Hexagonal** : `domain` ne dépend de rien ; ports & adapters ; framework en
  `infrastructure`/`interfaces`. Nouveau contexte sous `kobox/src/domain/torrent/` etc.
- **SQLite unique (WAL) + Drizzle**, migrations `drizzle-kit`. **Zod** à la frontière.
- **Worker root + file de jobs typée** : toute mutation privilégiée passe par un `Job` (enum
  fermé + payload Zod revalidé côté worker). Étends `JobType` / `jobPayloadSchemas`.
- **Aucun argument shell arbitraire** (`execFile` argv only). Secrets jamais loggés/commités.
- **Anti-régen destructive** : état désiré déclaratif + **idempotent** + **golden-tested** ;
  jamais de `>` sur un fichier potentiellement édité. C'est LE cœur de cette phase (§5.2).

### 3. Périmètre Phase 1 — EXACT (Torrent Lifecycle)

**DANS le périmètre** :
- **Agrégat `TorrentInstance`** (une instance rTorrent par user) + VOs : `InfoHash`,
  `WatchDir`/`Label` (`custom1`), `SessionDir`, `TorrentState`, `EventHook`, `Announcer`.
- **Rendu déclaratif de `.rtorrent.rc` et des hooks** (`inserted_new`/`finished`/`erased`)
  depuis des templates, **idempotent + golden files** — met fin à la régen destructive (§5.2
  `bCreateNewFile=1`, écrasement de tous les users). Ports : `RtorrentConfigPort`,
  `WatchDirPort`, un `ServiceControlPort` (déjà en Phase 0, à étendre : start/stop/reload réel
  de `rtorrent-<user>`, + **provisioning de l'unité** — cf. la dette Phase 0 : create/suspend
  tolèrent une unité absente, Phase 1 la crée).
- **Shims d'événements rtorrent** (`~/.rTorrent_{finished,inserted_new,erased}.sh`, ~5 lignes)
  qui appellent `kobox torrent-event <type> --hash …` → enqueue un `Job` typé. Zéro logique
  dans le bash.
- **Convertir les 2 patches fichiers survivants** (`PROD-INSPECTION §5`) en **first-class** :
  colonnes DB `allow_public_tracker` (par user) et `sync_disabled` (par user) + **early-exit
  natif** pour les adds XMLRPC sans `.torrent`. Plus jamais d'édition post-rendu.
- **Use cases** : `ProvisionRtorrentInstance`, `RenderRtorrentConfig`, `HandleTorrentEvent`
  (inserted_new/finished/erased), `AddWatchDir`, `SetSyncDisabled`, `SetAllowPublicTracker`.
- **Instrumentation** : réutilise le `HealthProbePort` (process+socket) — sonde réelle de
  `rtorrent-<user>` (le crash-mais-« active » vu en prod).
- **Pyramide de tests complète** : unit (VOs, fast-check sur `InfoHash`/ports), component
  (use cases + fakes), **golden files** pour tout `.rtorrent.rc`/hook rendu, integration
  (Drizzle réel), E2E Debian 12 (provisionne une instance → `.rtorrent.rc` correct → event
  `finished` traité → flags DB respectés).

**HORS périmètre Phase 1** (défère) : Tracker & cert SSL (Phase 2), Security/fair-use/métering
(Phase 3), portail (Phase 6). Poser les **interfaces** qui les anticipent est OK ; les
implémenter non.

### 4. Méthode (identique Phase 0)

- Branche `feature/phase1-torrent-lifecycle` depuis `main`. **Un commit par unité**, messages
  conventional-commits (en anglais) + `Co-Authored-By`.
- Pour chaque unité : `test-driven-development` (red→green→refactor), puis
  `verification-before-completion` (preuve d'exécution) avant de déclarer « fait ».
- Sur tout bug : `systematic-debugging`.
- Fin de phase : `requesting-code-review`, corriger, **PR draft** → `main` (<200 mots), ne pas
  merger sans validation.

### 5. Garde-fous (STOP si franchi)

1. **NE JAMAIS toucher la seedbox de prod.** Tout dev/test en **local Docker + VM**.
2. **NE JAMAIS toucher le legacy MySB** (`install/ web/ inc/ bin/ scripts/ templates/ upgrade/`).
   KoBox = code neuf sous `kobox/`.
3. **Repo PUBLIC — zéro identité prod/perso** : jamais l'hôte/IP réels, le propriétaire, ni les
   users réels. Fixtures neutres (`user-a..h`, `alice`/`bob`). Le hook pre-commit bloque déjà
   les identifiants connus (liste base64) ; ne le contourne pas.
4. **Budget CI GitHub Free** : la qualité se verrouille en **local** (hooks pre-commit /
   pre-push versionnés dans `kobox/.githooks`, activés par `pnpm prepare`). CI path-filtrée,
   job conteneur Debian 12 seulement sur PR. Ne push que du vert (le pre-push le garantit).
5. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ; `exec`+string
   shell interdit. Pas de queue externe (la file de jobs est en SQLite).
6. Toute action **irréversible** (force-push, suppression, réseau sortant) → **demande d'abord**.

### 6. État au démarrage (mémo)

- **Phase 0 (User Management) est mergée sur `main`** : VOs, `SeedboxUser`, use cases
  create/delete/change-password/suspend/resume, worker root + jobs typés, SQLite/Drizzle,
  adapters système + fakes, CLI `kobox`, E2E Debian 12 vert, CI, Dependabot, hooks.
- **Scope v1** : figé dans `docs/AUDIT.md §7`, mais **le propriétaire peut retirer d'autres
  services** (Plex/Tautulli/NetData déjà retirés ; liste non close). Vérifier avant de câbler
  un service.
- **Dette Phase 0 connue** (à traiter en Phase 1 quand pertinent) : le provisioning de l'unité
  systemd `rtorrent-<user>` appartient à Phase 1 ; `CreateUser`/`SuspendUser` tolèrent
  aujourd'hui une unité absente.
