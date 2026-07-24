# KoBox — Brief d'implémentation Phase 3 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à la **Phase 3** du rewrite
> KoBox (bounded context **Security & Network + Observabilité fair-use**), en autonomie, en TDD,
> dans la continuité des Phases 0, 1 et 2.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 3 de KoBox — Security & Network + Observabilité fair-use** telle
que cadrée dans `docs/AUDIT.md §1.5 + §3.7 (couches 2-3) + §6 (phase 3)`, en réutilisant les
fondations des Phases 0 (User Management), 1 (Torrent Lifecycle) et 2 (Tracker & Blocklist),
**toutes mergées sur `main`**. **Autonomie totale, TDD strict, un commit par unité de travail,
une PR draft pour la phase.** Ne re-débats aucune décision d'archi figée dans `docs/AUDIT.md`.
**C'est la tranche qui neutralise le cas user-h de bout en bout.**

### 0. État au démarrage (mémo — lis d'abord la mémoire projet)

- **La branche principale est `main`.** Phases 0/1/2 mergées (Phase 2 via PR #6).
- Phase 2 a posé les **interfaces du partenariat Tracker↔Security** (AUDIT §2) :
  `NetworkServiceReloadPort` (adapter best-effort à remplacer par la vraie gestion des services
  bind9/dnscrypt/pgl), rendu déclaratif de `/etc/bind/kobox.zones.blacklists`,
  `/etc/dnscrypt-proxy/blocked-names.txt`, `/etc/pgl/allow.p2p`, et la table `user_addresses`
  (IPv4 statiques — le volet DynDNS hostname arrive en Phase 3).
- Détails et pièges des phases précédentes dans les mémoires projet (rtorrent, seam privilège,
  fixtures E2E : serveurs locaux + `execFile` **async** quand le test héberge un serveur).

### 1. Lis d'abord, dans l'ordre (obligatoire avant toute action)

1. `docs/AUDIT.md` — la référence (**§1.5 Security & Network**, **§3.7 observabilité/fair-use
   couches 2-3 + décisions figées du 2026-07-23** : réponse graduée alerte→throttle auto,
   suspension manuelle ; canaux ntfy + email + Discord ; §5.2 régénération destructive du
   firewall ; issue #120 couplage firewall/blocklist).
2. `docs/PROD-INSPECTION.md` — modèle réel : chaîne `pgl_in` en tête d'INPUT policy DROP,
   11 jails fail2ban (⚠️ aucun ne capte le flood « Accepted publickey » — le vecteur user-h :
   1979 connexions/jour en clé valide), `DynamicAddressResolver` cron */5, OpenVPN ×3
   (TUN/TAP, avec/sans GW), Bind/DNScrypt effectifs, `users_addresses` 36 lignes
   (check_by ipv4/hostname).
3. `docs/DEV.md` — dev/test local (Docker + VM), fixtures réseau locales Phase 2.
4. `kobox/` — réutilise : VOs, ports/fakes, worker root + jobs typés (`ChainHints`),
   `ManagedFilesPort` (write-if-changed, `domain/shared/files.ts`), `RenderedFile`,
   `NotificationPort`/`TrackerNotificationPort` (à généraliser multi-canal),
   `HealthProbePort`, adapters `execFile` argv-only (`CommandRequest.timeoutMs`).
5. `~/.claude/CLAUDE.md` — standards de code (appliqués sans exception).

Invoque **`writing-plans`** pour transformer ce brief en plan d'exécution avant de coder, puis
**`test-driven-development`** pour chaque unité, **`systematic-debugging`** sur tout bug,
**`requesting-code-review`** en fin de phase.

### 2. Décisions VERROUILLÉES (héritées — ne pas re-trancher)

- TypeScript strict, `any` interdit, `readonly` constructeur-only, optional chaining.
- Hexagonal : nouveau contexte sous `kobox/src/domain/security/` ; `domain` ne dépend de rien.
- SQLite unique (WAL) + Drizzle ; Zod à la frontière ; étends `JobType`/`jobPayloadSchemas`.
- `execFile` argv only ; **jamais** de chaîne shell ; état désiré déclaratif + idempotent +
  golden-testé (règles iptables via `iptables-restore` d'un fichier rendu — jamais de `-A`
  incrémental non maîtrisé) ; jamais de `>` sur un fichier édité.
- **Réponse graduée FIGÉE** (the maintainer 2026-07-23) : `alerte` → (si persiste) `throttle
  auto` via `ShapingPort` (tc/HTB) → **suspension MANUELLE** (`SuspendUser` existant). Toute
  action réversible et auditée (events + historique).
- **Canaux d'alerte FIGÉS** : ntfy + email (relais Postfix) + Discord via `NotificationPort`
  multi-canal.

### 3. Périmètre Phase 3 — EXACT

**DANS le périmètre** :
- **Agrégat `FirewallPolicy`** + VOs (`Cidr`, `JailName`, `DynDnsHost`, `Bandwidth`,
  `EgressRate`/`ConnectionRate`, `FairUsePolicy`/`ResourceBudget`, `Threshold`) : default-deny,
  chaînes par user, rendu déclaratif complet (`iptables-restore`) golden-testé — fin du cycle
  clean/create/refresh destructif (§5.2). Politique réseau **découplée** du bus de jobs
  (issue #120).
- **Fail2ban déclaratif** : jails rendues (sshd, nginx…), `ignoreip` depuis `user_addresses`,
  **+ la règle custom « publickey flood »** (journald : « Accepted publickey » — là où fail2ban
  est aveugle).
- **Restrict IP DynDNS** : `DynDnsHost` VO, résolution périodique (job `resolve-dyndns`),
  refresh firewall/whitelists/allow.p2p quand l'IP change (remplace `DynamicAddressResolver`) —
  étend `user_addresses` au `check_by hostname`.
- **Reprise réelle de `NetworkServiceReloadPort`** : gestion bind9/dnscrypt/pgl comme services
  (install/config/reload), le partenariat Tracker↔Security devient effectif.
- **OpenVPN multi-config** (TUN/TAP × avec/sans GW, profils client par user) — rendu déclaratif
  des configs, **sans** `comp-lzo` (VORACLE, cf. PROD-INSPECTION §2).
- **Métering par user** (`UsageMeterPort`) : egress/ingress par uid (compteurs iptables
  `-m owner`), taux de connexions/auth SSH (journald), disque/quota, nb torrents.
- **`FairUseEvaluator`** (service de domaine planifié) : observé vs `FairUsePolicy` → events
  (`FairUseBreached`, `AbnormalAuthRate`, `ServiceUnhealthy`) → réponse graduée (alerte →
  `ShapingPort` throttle tc/HTB auto → suspension manuelle).
- **`NotificationPort` multi-canal réel** : ntfy + email + Discord (remplace le stub console).
- **Pyramide complète** : unit (VOs fast-check sur `Cidr`/`DynDnsHost`), component (use cases +
  fakes), golden files (rulesets iptables, jails, configs OpenVPN), integration (iptables-restore
  réel en conteneur privilégié, journald), E2E Debian 12 (⚠️ **ne pas se verrouiller dehors** :
  E2E robustes d'abord — la policy default-deny doit préserver SSH/loopback/established).

**HORS périmètre** (défère) : Installation/Provisioning (Phase 4), Maintenance & Ops (Phase 5),
portail (Phase 6). RKHunter/Lynis/Portsentry = config vendored, pas de logique KoBox.

**Dette héritée de la Phase 2 à solder au passage** (issues de code review, non bloquantes) :
- chaîner `render-blocklist-filters {username}` après `provision-rtorrent` (parité legacy :
  un nouvel user reçoit son filtre sans attendre le prochain `update-blocklists`) ;
- durcir l'E2E blocklist : prouver le parse du filtre via le journal rtorrent
  (« IPv4 filter list size ») plutôt que le seul état `active`.

### 4. Méthode (identique Phases 0/1/2)

- Branche `feature/phase3-security-network` depuis `main`. **Un commit par unité**,
  conventional-commits (anglais) + `Co-Authored-By`.
- Pour chaque unité : `test-driven-development` (red→green→refactor), puis
  `verification-before-completion` (lint + typecheck + coverage + build + intégration + E2E
  conteneur) avant de déclarer « fait ».
- Fin de phase : `requesting-code-review`, corriger (`receiving-code-review`), **PR draft** →
  `main` (<200 mots, **sans lien de session**), ne pas merger sans validation.

### 5. Garde-fous (STOP si franchi)

1. **NE JAMAIS toucher la seedbox de prod.** Tout dev/test en local Docker + VM.
2. **NE JAMAIS toucher le legacy MySB** (`install/ web/ inc/ bin/ scripts/ templates/ upgrade/`,
   lecture seule pour référence).
3. **Repo PUBLIC — zéro identité prod/perso** : fixtures neutres (`user-a..h`, `alice`/`bob`,
   plages doc 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, `dyn.example.org`). Le hook
   pre-commit bloque les identifiants connus ; ne le contourne pas.
4. **Budget CI GitHub Free** : qualité verrouillée en local (hooks versionnés). Ne push que du
   vert. (⚠️ `pnpm ... | tail` masque le code retour en zsh.)
5. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ; `exec`+string
   shell interdit. **Firewall : jamais d'application de règles hors conteneur/VM.**
6. Toute action **irréversible** (force-push, suppression, réseau sortant réel) → **demande
   d'abord**. Les tests visent des serveurs/fixtures locaux, jamais le réseau.

### 6. Dette / points d'attention connus

- **Le piège n°1 de cette phase : se verrouiller dehors.** Toute policy default-deny rendue doit
  garantir loopback + established + SSH (22) **avant** le premier `iptables-restore` en E2E ;
  prévois un garde-fou type `iptables-apply` (rollback si le test de connectivité échoue).
- **Fixtures E2E** : quand le test héberge un serveur (TLS/HTTP), lance worker/CLI enfants en
  **async** (`execFile` promisifié) — un `execFileSync` gèle la boucle d'événements et les
  handshakes (vécu en Phase 2, documenté dans `docs/DEV.md`).
- **`CommandRequest.timeoutMs`** existe (Phase 2) — budgète chaque commande réseau.
- **Chaînage worker** : passe par les rapports de use cases (`ChainHints` dans `JobWorker`) —
  les use cases ne touchent jamais la queue.
- **user-h, cause racine** (AUDIT §3.7) : pas de dashboard de plus — attribution par user,
  alerte push, réponse graduée. La règle « publickey flood » est le jail manquant prouvé en prod.
- Quand tu as terminé, écris le prompt de la prochaine session (Phase 4 — Installation &
  Provisioning) avec le document lié, comme pour ce brief.
