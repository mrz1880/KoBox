# KoBox — Brief Phase 8 (post-cutover hardening & backlog v1.1)

> Prompt de reprise pour une **session Claude Code fraîche**. Les Phases 0-7 sont livrées :
> KoBox est fonctionnellement complet et la **migration + cutover** est codée (Phase 7,
> `docs/PHASE-7-BRIEF.md`). Cette session finalise la mise en prod puis solde la dette v1.1.

---

## Prompt (à coller dans la session d'implémentation)

Mission : **exécuter le cutover prod (sur GO the owner) puis livrer le backlog de durcissement
v1.1**. Vérifie l'état avec `git log`/`gh pr list` et la **mémoire projet**.

### 0. État au démarrage (lis d'abord la mémoire)

- Phases 0-6 mergées sur `main`. **Phase 7 (Migration & Cutover) = PR #11 en DRAFT**, non mergée :
  le code d'import est prêt et 100 % vert (819 unit/component/contract, 85 integration, 51 E2E
  Debian 12), mais **aucune écriture prod n'a eu lieu**. Cf. [[phase7-migration-cutover-done]].
- La migration : `kobox migrate-from-mysb --dump <dir> [--dry-run|--apply]`, dry-run par défaut,
  idempotente, isolée par-user, re-run réparateur. Runbook complet : `docs/CUTOVER.md`.

### 1. Lis d'abord (obligatoire)

1. `docs/CUTOVER.md` **en entier** (l'ordre exact du cutover, la recette de dump read-only, la
   bascule nginx `:8189` atomique, la fenêtre de rollback).
2. `docs/PHASE-7-BRIEF.md` §0 (**dette laissée** : durcissement portail #4) + `docs/AUDIT.md` §7
   (scope v1 figé — Webmin/SM/Cakebox = KEEP).
3. `HANDOFF.md` (git-ignoré) — le seul accès prod, read-only, sur sollicitation.

### 2. Garde-fous (STOP si franchi) — inchangés

- **NE JAMAIS écrire sur la prod sans GO explicite the owner.** Le cutover (§3.A) ne s'exécute
  que sur validation ; toute action irréversible (write prod, bascule DNS/nginx, force-push) →
  demande d'abord.
- Repo PUBLIC : zéro identité prod/perso, fixtures neutres, `HANDOFF.md` git-ignoré, hook
  pre-commit. `any` interdit, `readonly` ctor-only, optional chaining, exec+string shell interdit.
- Budget CI GitHub Free : qualité verrouillée en local (⚠️ `cd kobox` avant `pnpm …` ; `| tail`
  masque le code retour en zsh).

### 3. Périmètre Phase 8

**A. Cutover prod (uniquement sur GO the owner)** — dérouler `docs/CUTOVER.md` : geler MySB →
produire le dump (read-only) → `migrate-from-mysb --dry-run` + revue → `kobox install` sur la
cible → `--apply` → régénérer (`send-mails`, `render-openvpn`, `renew-tracker-certs`,
`update-blocklists`) → smoke par user → bascule nginx `:8189` → fenêtre de rollback. **Puis merger
la PR #11** une fois le cutover validé et stable.

**B. Durcissement portail** (dette Phase 6/7 §0 #4, non bloquant, TDD) :
1. **Composition dédiée au portail** qui n'instancie **pas** le `JobWorker` ni les adapters
   privilégiés — la frontière n'est plus tenue que par l'interface `PortalServerDeps` + le process
   non-root, mais par ce que le process construit.
2. **`EnvironmentFile` propre au portail** (aujourd'hui il partage `worker.env`, qui porte des
   secrets inutiles : `KOBOX_IBLOCKLIST_PIN`/`KOBOX_DISCORD_WEBHOOK`/`KOBOX_NTFY_URL`).
3. **`ProtectSystem=strict` + `ReadWritePaths=/var/lib/kobox`** sur l'unité portail (écarté en
   Phase 6 car l'E2E d'install pose la DB sous `/tmp` — régler avec une DB hors `/tmp`).

**C. Extras en composants d'install dédiés** (scope v1 KEEP, AUDIT §7) : Webmin, Seedbox-Manager,
Cakebox-Light comme composants du `COMPONENT_CATALOG` (vendored/liés-iframés comme ruTorrent),
avec état déclaratif + E2E.

**D. VPN client NordVPN (#47)** : profil client sortant (le pendant du serveur OpenVPN).

**Optionnel / si demandé** : lecture live MariaDB pour `MysbSourcePort` (aujourd'hui dump-only) ;
réparation Minio ; arrêt du pin ruTorrent officiel (process `docs/OPS.md`).

### 4. Méthode (identique Phases 0-7)

Branche `feature/phase8-hardening` depuis `main` (après merge Phase 7). Un commit par unité,
conventional-commits anglais + `Co-Authored-By`. Par unité : TDD (red→green→refactor) puis
`verification-before-completion` (lint + typecheck + coverage + build + integration + E2E
conteneur). Fin de phase : `requesting-code-review`, PR draft (<200 mots, **sans lien de session**,
cf. [[no-session-link-in-prs]]), ne pas merger sans validation. Écris le brief de la session
suivante.

### 5. Dette / points d'attention

- Le temp pw de migration ne vit que dans `mails.body` (secret at rest accepté) → `send-mails` tôt.
- `allow_public_tracker`/`sync_disabled` sont des toggles post-migration (`kobox set-… <user> on`).
- Ports préservés : ne jamais re-router un user migré (casse ses torrents).
