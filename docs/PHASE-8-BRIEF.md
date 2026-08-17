# KoBox, brief Phase 8 (cutover prod & backlog v1.1)

> Prompt de reprise pour une **session Claude Code fraîche**. Les Phases 0-7 sont livrées et
> mergées : KoBox est fonctionnellement complet, la migration est codée et validée à blanc sur un
> dump réel, mais **le cutover prod n'a pas eu lieu**. Cette session le déroule sur GO, puis solde
> le backlog v1.1.
>
> Dernière mise à jour : 2026-08-17.

---

## Prompt (à coller dans la session d'implémentation)

Mission : **exécuter le cutover prod (sur GO the owner) puis livrer le backlog v1.1**. Vérifie
l'état avec `git log` / `gh pr list` et la **mémoire projet** avant de croire ce document.

### 0. État au démarrage (lis d'abord la mémoire)

- **Tout est mergé sur `main`**, Phase 7 comprise (PR #11). Aucune PR ni issue ouverte.
- `main` est vert de bout en bout : 1188 tests unit/contract/component/integration (27 skipped,
  gatés Debian) et 69 E2E contre un vrai rtorrent en conteneur.
- **Aucune écriture prod n'a jamais eu lieu.** Le code d'import a tourné à blanc sur un dump réel
  (8 comptes, 46 trackers, 316 blocklists, 4232 torrents, 33 adresses). Cf.
  [[phase7-migration-cutover-done]].
- La migration : `kobox migrate-from-mysb --dump <dir> [--dry-run|--apply]`, dry-run par défaut,
  idempotente, isolée par-user, re-run réparateur. Runbook : `docs/CUTOVER.md`.

### 1. Lis d'abord (obligatoire)

1. `docs/CUTOVER.md` **en entier** : l'ordre exact du cutover, la recette de dump read-only, la
   remise d'un token applicatif avant bascule (§8ter), la bascule nginx `:8189` atomique, la
   fenêtre de rollback.
2. `docs/AUDIT.md` §7 (scope v1 figé : Webmin / Seedbox-Manager / Cakebox-Light = KEEP).
3. `HANDOFF.md` (git-ignoré) : le seul accès prod, **read-only**, sur sollicitation.
4. `docs/OPS.md`, section « Getting a torrent onto the box » : les trois chemins d'ajout et la
   règle de confidentialité, qui conditionnent le point B ci-dessous.

### 2. Garde-fous (STOP si franchi)

- **NE JAMAIS écrire sur la prod sans GO explicite the owner.** Le cutover (§3.A) ne s'exécute que
  sur validation ; toute action irréversible (write prod, bascule DNS/nginx, force-push) se demande
  d'abord.
- Sur la seedbox : **lecture seule**, toujours. Ne jamais ouvrir `~/db/*.sq3` (mots de passe NAS en
  clair). Ne jamais faire transiter un secret par le prompt.
- Repo PUBLIC : zéro identité prod/perso, fixtures neutres, `HANDOFF.md` git-ignoré, hook
  pre-commit qui refuse la liste d'identifiants. `any` interdit, `readonly` sur les champs
  affectés au constructeur seulement, optional chaining, `exec` + chaîne shell interdits.
- Budget CI GitHub Free : la qualité se verrouille en local. `cd kobox` avant tout `pnpm …`, et
  attention au `| tail` qui masque le code retour en zsh.
- **Jamais de tiret cadratin** dans le code, les commentaires, les commits, les PR ni les réponses.
  Le repo en porte encore ~1250 sur 273 fichiers : ils se corrigent **au fil de l'eau**, sur les
  lignes que tu touches, jamais en PR de nettoyage dédiée. Cf. [[em-dash-fix-incrementally]].
- **Jamais d'attribution Claude** dans les commits, PR, issues ou commentaires, ni de lien de
  session. Cf. [[no-session-link-in-prs]].

### 3. Périmètre Phase 8

**A. Cutover prod (uniquement sur GO the owner).** Dérouler `docs/CUTOVER.md` : geler MySB,
produire le dump en lecture seule, `migrate-from-mysb --dry-run` puis revue, `kobox install` sur la
cible, `--apply`, régénérer (`send-mails`, `render-openvpn`, `renew-tracker-certs`,
`update-blocklists`), smoke par utilisateur, bascule nginx `:8189`, fenêtre de rollback.

**B. Réglages par-membre atteignables. LIVRÉ (PR #44, 2026-08-17).** `SetAllowPublicTracker` et
`SetSyncDisabled` existaient en use case, câblés dans `useCases.ts` et `buildJob.ts`, sans aucune
commande CLI ni route portail pour les appeler : le réglage était inatteignable. Les deux sont
maintenant sur la fiche du membre dans la console admin, formulés par ce que ça change pour lui
plutôt que par le nom de la colonne.

Deux choses à savoir avant d'y toucher. La raison historique d'activer le bypass trackers publics a
disparu : un ajout XMLRPC perdait son attribut privé/public et se faisait bloquer comme public,
`d.is_private` voyage désormais sur l'événement `inserted_new`, donc la règle s'applique pareil
quel que soit le chemin d'arrivée. Et `syncDisabled` **n'est pas** la synchro KoBox malgré son nom :
il coupe les scripts personnels du membre (`~/scripts/*.sh`) après un téléchargement, alors que
chaque dossier suit son propre mode via le scheduler.

**C. Extras en composants d'installation** (scope v1 KEEP, AUDIT §7). Le `COMPONENT_CATALOG`
compte 23 composants (`apt-sources`, `rtorrent`, `rutorrent`, `nginx`, `portal`, `nanomon`,
`aria2`, …) et **ni Webmin, ni Seedbox-Manager, ni Cakebox-Light**. Les cinq écrans Webmin sont
livrés côté portail, mais l'installation reste hors du modèle déclaratif. Les ajouter comme
composants (vendorés ou liés en iframe comme ruTorrent), avec état déclaratif et E2E.

**Hors périmètre : le VPN client type NordVPN.** L'issue #47 vient du dépôt MySB d'origine, pas
d'une demande de l'owner, et se recopiait de brief en brief depuis `docs/AUDIT.md` où elle figure au
backlog amont non résolu. Retirée du périmètre le 2026-08-17, au même titre que Plex, Tautulli et
NetData. Ne pas la réintroduire sans demande explicite : `docs/AUDIT.md` la garde comme trace
historique des issues MySB, ce qui n'en fait pas un engagement.

**Optionnel, si demandé** : lecture live MariaDB pour `MysbSourcePort` (aujourd'hui dump seulement)
; réparation Minio ; sortie du pin ruTorrent officiel (process décrit dans `docs/OPS.md`).

### 4. Méthode (identique Phases 0-7)

Branche `feature/phase8-hardening` depuis `main`. Un commit par unité, conventional-commits en
anglais. Par unité : TDD strict (red, green, refactor, en vérifiant que le test échoue pour la
bonne raison) puis `verification-before-completion` (lint, typecheck, coverage, build, integration,
E2E en conteneur). **Faire tourner l'E2E en local avant de pousser** : `make up && make install`
puis `pnpm test:e2e` dans le conteneur, avec `docker compose exec -T` (sans `-T`, le TTY propage
les signaux à PID 1 et tue le conteneur). Cf. [[e2e-run-locally-first]].

Fin de phase : `requesting-code-review`, PR en draft de moins de 200 mots, ne pas merger sans
validation. Écrire le brief de la session suivante.

### 5. Dette et points d'attention

- Le mot de passe temporaire de migration ne vit que dans `mails.body` (secret at rest accepté),
  donc `send-mails` doit partir tôt dans le cutover.
- **Ports préservés** : ne jamais re-router un utilisateur migré, ça casse ses torrents.
- Le conteneur de démo tourne sur le NAS en `privileged` avec `restart: unless-stopped`. À arrêter
  quand la démo aura servi, ce n'est pas une configuration à laisser vivre.
- MySB souffre du même défaut d'attribut privé/public, corrigeable en passant `$d.is_private=` au
  shim `inserted_new`. Sans intérêt une fois le cutover fait ; utile seulement si MySB doit vivre
  encore un moment.
