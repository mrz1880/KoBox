# KoBox — Brief d'implémentation Phase 2 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à la **Phase 2** du rewrite
> KoBox (bounded context **Tracker & Blocklist**), en autonomie, en TDD, dans la continuité des
> Phases 0 et 1.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 2 de KoBox — Tracker & Blocklist** telle que cadrée dans
`docs/AUDIT.md §1.4 + §6 (phase 2)` et en réutilisant les fondations des Phases 0 (User
Management, mergée sur `v7.3`) et 1 (Torrent Lifecycle, **draft PR #5**, branche
`feature/phase1-torrent-lifecycle`). **Autonomie totale, TDD strict, un commit par unité de
travail, une PR draft pour la phase.** Ne re-débats aucune décision d'archi figée dans
`docs/AUDIT.md`.

### 0. État au démarrage (mémo — lis d'abord la mémoire projet)

- **Phase 0** (User Management) est **mergée sur `v7.3`**.
- **Phase 1** (Torrent Lifecycle) est **livrée en draft PR #5** vers `v7.3`, PAS ENCORE MERGÉE.
  → **Vérifie l'état de la PR #5 avant de partir.** Si elle est mergée, branche Phase 2 depuis
  `v7.3`. Si elle ne l'est **pas**, branche Phase 2 depuis `feature/phase1-torrent-lifecycle`
  (Phase 2 dépend de l'agrégat `TorrentInstance`, du parsing metainfo/`Announcer` et de la
  découverte des annonceurs posés en Phase 1) — et signale-le dans la description de PR.
- Détails Phase 1 dans la mémoire `[[phase1-torrent-lifecycle-done]]` (pièges rtorrent inclus).

### 1. Lis d'abord, dans l'ordre (obligatoire avant toute action)

1. `docs/AUDIT.md` — la référence (**Tracker & Blocklist = §1.4 + phase 2**, anti-patterns §5.1
   sur l'injection root via `${Tracker}` non échappé, §5.6 TLS globalement désactivé).
2. `docs/PROD-INSPECTION.md` — modèle réel : `trackers_list` (46 privés, `is_ssl`,
   `to_check`∈{0,1,3}, `is_dead`), `trackers_list_ipv4` (1:N), `blocklists` (8 iblocklist),
   PeerGuardian `allow.p2p` (110 lignes), zones DNS blacklist.
3. `docs/DEV.md` — dev/test local (Docker + VM), spool d'events, `KOBOX_BIN`.
4. `kobox/` — réutilise l'archi Phase 0/1 : VOs, ports, fakes, worker root, file de jobs typée,
   adapters `execFile`, rendu déclaratif golden-testé, `RtorrentConfigPort` (apply
   write-if-changed), `Announcer` VO + `BencodeMetainfoAdapter` (annonceurs déjà extraits).
5. `~/.claude/CLAUDE.md` — standards de code (appliqués sans exception).

Invoque **`writing-plans`** pour transformer ce brief en plan d'exécution avant de coder, puis
**`test-driven-development`** pour chaque unité, **`systematic-debugging`** sur tout bug,
**`requesting-code-review`** en fin de phase.

### 2. Décisions VERROUILLÉES (héritées Phases 0/1 — ne pas re-trancher)

- TypeScript strict, `any` interdit, `readonly` constructeur-only, optional chaining.
- Hexagonal : `domain` ne dépend de rien ; ports & adapters. Nouveau contexte sous
  `kobox/src/domain/tracker/`.
- SQLite unique (WAL) + Drizzle, migrations `drizzle-kit`. Zod à la frontière.
- Worker root + file de jobs typée : étends `JobType` / `jobPayloadSchemas` (revalidés côté worker).
- **Aucun argument shell arbitraire** (`execFile` argv only). Le VO `TrackerHost` DOIT être
  shell-safe par construction (FQDN validé) — c'est la correction directe de l'injection root
  §5.1 (`openssl s_client -connect ${Tracker}:${port}`). Secrets jamais loggés/commités.
- **Anti-régen destructive** : état désiré déclaratif + idempotent + golden-tested (zones BIND,
  `blocked-names.txt` dnscrypt, `allow.p2p`, listes iblocklist rendues, jamais de `>` sur un
  fichier édité). Réutilise le pattern `RenderedFile`/apply de Phase 1.

### 3. Périmètre Phase 2 — EXACT (Tracker & Blocklist)

**DANS le périmètre** :
- **Agrégat `Tracker`** + VOs : `TrackerHost` (FQDN shell-safe), `TrackerProto` (http/https/udp),
  `TrackerPrivacy` (public/private), `CertExpiry`, `TrackerStatus` (`to_check`/`is_dead`).
  Agrégat/entité `Blocklist` + VOs `BlocklistUrl`, `BlocklistSource` (perso vs iblocklist/abonnement).
- **Cert SSL auto par tracker** (feature signature) : port `TrackerCertPort` (adapter `openssl
  s_client` → PEM → `/etc/ssl/certs`, **argv only**, `TrackerHost` shell-safe), renouvellement
  (cert_expiration ≤ today), désactivation auto d'un tracker mort + alerte via `NotificationPort`.
- **Découverte des trackers depuis les torrents** : consomme les `Announcer` déjà extraits en
  Phase 1 (event `inserted_new`) → alimente `trackers_list`. Décide la relation de contexte
  (Torrent publie un event de domaine consommé par Tracker — cf. AUDIT §2 context map).
- **Whitelist trackers** : rendu déclaratif idempotent des zones BIND
  (`MySB.zones.blacklists`), `blocked-names.txt` dnscrypt, et `allow.p2p` PeerGuardian (IP users
  + trackers). Golden files.
- **Blocklists** : catalogue iblocklist (XML → DB), listes perso, `ipv4_filter.load` par user
  (drop-in `config.d/80-blocklist.rc` déjà anticipé par le rendu Phase 1), résilience
  (abonnement périmé ne bloque pas la MAJ des listes standard — issue #117), téléchargements
  **vérifiés** (hash/intégrité — corrige §5.6 `curl --insecure`).
- **Use cases** : `FetchTrackerCert`, `RenewTrackerCerts`, `DiscoverTrackerFromTorrent`,
  `MarkTrackerDead`, `UpdateBlocklists`, `RenderWhitelist`, `RenderBlocklistFilters`.
- **Pyramide de tests complète** : unit (VOs, fast-check sur `TrackerHost` shell-safety),
  component (use cases + fakes), **golden files** pour zones/allow.p2p/blocked-names/filtres,
  integration (Drizzle réel + openssl/bind/dnscrypt réels en conteneur), E2E Debian 12
  (découverte tracker → cert fetché → whitelist rendue → blocklist appliquée).

**HORS périmètre Phase 2** (défère) : Security/firewall/fail2ban/DynDNS/VPN + métering
fair-use (Phase 3), portail (Phase 6). Poser les **interfaces** anticipant Security (le cert
promeut un tracker en https ET ouvre `allow.p2p` + zone DNS — partenariat Tracker↔Security,
AUDIT §2) est OK ; implémenter Security non.

### 4. Méthode (identique Phases 0/1)

- Branche `feature/phase2-tracker-blocklist` depuis la bonne base (cf. §0). **Un commit par
  unité**, conventional-commits (anglais) + `Co-Authored-By`.
- Pour chaque unité : `test-driven-development` (red→green→refactor), puis
  `verification-before-completion` (preuve d'exécution : lint + typecheck + coverage + build +
  E2E conteneur) avant de déclarer « fait ».
- Fin de phase : `requesting-code-review`, corriger (`receiving-code-review`), **PR draft** →
  `v7.3` (<200 mots), ne pas merger sans validation.

### 5. Garde-fous (STOP si franchi)

1. **NE JAMAIS toucher la seedbox de prod.** Tout dev/test en local Docker + VM.
2. **NE JAMAIS toucher le legacy MySB** (`install/ web/ inc/ bin/ scripts/ templates/ upgrade/`).
   KoBox = code neuf sous `kobox/`. (Le `templates/` legacy est lu pour référence uniquement.)
3. **Repo PUBLIC — zéro identité prod/perso** : jamais l'hôte/IP réels, le propriétaire, ni les
   trackers réels. Fixtures neutres (`tracker.example.org`, `user-a..h`, `alice`/`bob`). Le hook
   pre-commit bloque les identifiants connus (liste base64) ; ne le contourne pas.
4. **Budget CI GitHub Free** : qualité verrouillée en local (hooks pre-commit/pre-push versionnés
   `kobox/.githooks`). Ne push que du vert (le pre-push le garantit). E2E conteneur en local avant
   push. (⚠️ le pipe `| tail` masque le code retour de `pnpm test` en zsh — vérifie
   `${pipestatus[1]}` ou lance sans pipe.)
5. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ; `exec`+string shell
   interdit ; téléchargements non vérifiés interdits (hash/signature). Pas de queue externe.
6. Toute action **irréversible** (force-push, suppression, réseau sortant réel) → **demande d'abord**.
   Les fetch de certs/blocklists en test doivent viser des serveurs locaux/fixtures, jamais le réseau.

### 6. Dette / points d'attention connus

- **Pièges rtorrent** (vécus en Phase 1) : l'unité systemd ne fixe pas `Group=` (groupe primaire
  du user d'abord, pour lire les fichiers `root:<user> 0640`) ; le `.rtorrent.rc` bootstrap les
  répertoires avant `log.open`/session (parsing top-down). Le drop-in blocklist par user est
  `~/rtorrent/config.d/80-blocklist.rc` (déjà prévu par le rendu, à alimenter).
- **Injection root §5.1** : `${Tracker}` non échappé dans `openssl s_client` — c'est LE bug que
  le VO `TrackerHost` shell-safe + adapter argv-only ferme définitivement.
- **Idempotence des rendus réseau** : réutilise `RtorrentConfigPort.apply` (write-if-changed,
  ne touche jamais hors liste) comme modèle pour zones BIND / allow.p2p / dnscrypt.
- Quand tu as terminé, écris le prompt de la prochaine session (Phase 3 — Security & Network +
  Observabilité fair-use) avec le document lié, comme pour ce brief.
