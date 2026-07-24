# KoBox — Brief d'implémentation Phase 4 (session autonome)

> Prompt de reprise pour une **session Claude Code fraîche** dédiée à la **Phase 4** du rewrite
> KoBox (bounded context **Installation & Provisioning**), en autonomie, en TDD,
> dans la continuité des Phases 0, 1, 2 et 3.

---

## Prompt (à coller dans la session d'implémentation)

Mission : implémente la **Phase 4 de KoBox — Installation & Provisioning** telle que cadrée
dans `docs/AUDIT.md §1.1 + §3.6 + §6 (phase 4)`, en réutilisant les fondations des Phases 0-3
**toutes mergées sur `main`** (vérifie ; sinon la Phase 3 est en PR draft). **Autonomie totale,
TDD strict, un commit par unité de travail, une PR draft pour la phase.** Ne re-débats aucune
décision d'archi figée dans `docs/AUDIT.md`. **C'est la tranche qui rend KoBox installable sur
un Debian 12 vierge** — l'orchestrateur TS qui remplace `MySB.bsh` et ses ~45 installeurs bash.

### 0. État au démarrage (mémo — lis d'abord la mémoire projet)

- **La branche principale est `main`.** Phases 0/1/2 mergées ; Phase 3 (Security & Network +
  fair-use) en PR draft ou mergée — vérifie `git log`/`gh pr list`.
- La Phase 3 a livré : firewall déclaratif via garde `iptables-restore` (+rollback), fail2ban
  (jail « publickey flood »), DynDNS, OpenVPN rendu (PKI **lue**, jamais générée), métering
  par user, `FairUseEvaluator` (alerte → throttle tc/HTB auto → suspension manuelle),
  `NotificationPort` ntfy/email/Discord. `NetworkServiceAdapter` gère les reloads réels
  (tolérance explicite aux unités absentes — c'est le seam que la Phase 4 comble en
  **installant** ces services).
- Dette explicitement laissée à la Phase 4 (revue de code Phase 3) :
  1. **Persistance au boot du firewall** : `/etc/kobox/firewall.rules` n'est PAS rechargé au
     reboot (l'adapter détecte les tables vides via chaîne sentinelle et ré-applique au
     prochain `apply-firewall`, mais il faut une unité systemd `kobox-firewall.service`
     type oneshot `iptables-restore` au boot).
  2. **Bootstrap PKI OpenVPN** (easy-rsa : CA, server, un cert/clé par user + intégration
     create-user/delete-user → `render-openvpn`).
  3. Mineurs notés : classid tc 16 bits (uid > 65535), index manquant sur
     `fair_use_events.username`, un user suspendu garde sa classe tc (inerte, rtorrent coupé).

### 1. Lis d'abord, dans l'ordre (obligatoire avant toute action)

1. `docs/AUDIT.md` — la référence (**§1.1 Installation & Provisioning** : pré-checks, sources
   apt, bundles de paquets, tweaks/hardening, orchestration par phases, registre `services`,
   teardown ; **§3.6 le bash irréductible** : `bootstrap/install.sh` ~50 lignes ; §5.6 leçons
   ops ; Annexe B #122/#100/#119 : « l'install brique le serveur » = le pain n°1 historique).
2. `docs/PROD-INSPECTION.md` — l'état réel qu'une install doit produire (services actifs,
   layout, cron 26 lignes — le cron lui-même est Phase 5).
3. `docs/DEV.md` — conteneur/VM ; l'E2E d'install EST le produit de cette phase.
4. `kobox/` — réutilise : `CommandRunner` argv-only, `ManagedFilesPort`, worker/jobs typés,
   `ServiceControlPort`, `NetworkServicePort`, `SecuritySettings`, `securitySettings()`/env.
5. `~/.claude/CLAUDE.md` — standards de code (appliqués sans exception).

Invoque **`writing-plans`** avant de coder, puis **`test-driven-development`** pour chaque
unité, **`systematic-debugging`** sur tout bug, **`requesting-code-review`** en fin de phase.

### 2. Décisions VERROUILLÉES (héritées — ne pas re-trancher)

- TypeScript strict, `any` interdit, `readonly` constructeur-only, optional chaining.
- Hexagonal : contexte sous `kobox/src/domain/installation/` ; `domain` ne dépend de rien.
- SQLite unique (WAL) + Drizzle ; Zod à la frontière ; étends `JobType`/`jobPayloadSchemas`.
- `execFile` argv only ; état désiré déclaratif + idempotent + golden-testé ; **jamais** de
  `>` sur un fichier édité ; installs **transactionnelles/reprenables** (§5.6 : pas de
  reboot forcé mid-install, codes retour propagés, re-run sûr).
- Le bash irréductible = `bootstrap/install.sh` (~50 lignes : pré-checks, Node LTS, clone,
  `exec kobox install`) — tout le reste en TS testé.
- Vendored ≠ réécrit : on installe/configure bind9, dnscrypt-proxy, pgl, fail2ban, OpenVPN,
  nginx, Postfix, rtorrent/ruTorrent… (les rendus déclaratifs des Phases 1-3 deviennent
  effectifs parce que les services existent enfin).

### 3. Périmètre Phase 4 — EXACT

**DANS le périmètre** :
- **Agrégat `Installation`/`Component`** + VOs (`ComponentName`, `InstallState`
  to_install/installed/failed, `Version`/`Revision`) ; registre `services` en DB ; plan
  d'installation ordonné par dépendances, **reprenable** (un composant échoué se relance
  sans tout refaire — anti-#122).
- **Pré-checks** : Debian 12, root, arch, ext4, réseau — échec = message clair AVANT toute
  mutation.
- **Installeurs de composants** (ports + adapters `PackagePort` apt argv-only, units
  systemd rendues via `ManagedFilesPort`) pour le cœur v1 : ssh(d) durci, nginx, rtorrent/
  ruTorrent, bind9 + dnscrypt-proxy, pgl, fail2ban, OpenVPN (+ **bootstrap PKI easy-rsa**,
  la dette Phase 3), Postfix relay, quotas ext4 (hard), sysctl/tweaks (l'équivalent §1.1
  `Tweaks` en rendu déclaratif).
- **`kobox-firewall.service`** oneshot au boot (`iptables-restore /etc/kobox/firewall.rules`)
  + activation des unités KoBox (worker systemd) — la dette n°1 de la Phase 3.
- **`kobox install`** CLI : orchestre le plan, écrit le registre, idempotent au re-run ;
  **teardown** inverse (`kobox uninstall`, réversible, anti-CleanAll destructif).
- Chaînage : composant installé → jobs de rendu des phases précédentes (apply-firewall,
  render-fail2ban, render-whitelist, render-openvpn) pour converger vers l'état désiré.
- **Pyramide complète** : unit (VOs, plan/dépendances), component (orchestrateur + fakes),
  golden (units systemd, sysctl, sources.list, sshd_config.d), integration (apt réel en
  conteneur), **E2E : conteneur Debian 12 VIERGE → `bootstrap/install.sh` → stack complète
  verte** (le critère de done historique : « fresh Debian 12 → create user → tout marche »).

**HORS périmètre** (défère) : Maintenance & Ops (upgrades, cron/scheduler, backups, outbox
mail — Phase 5), portail (Phase 6), migration de données prod (cutover — après Phase 6).
Samba/NFS/NextCloud/Minio/Webmin/Seedbox-Manager/Cakebox/ShellInABox : installables en
vendored simple si le temps le permet, sinon Phase 5 — le cœur seedbox prime.

### 4. Méthode (identique Phases 0/1/2/3)

- Branche `feature/phase4-installation` depuis `main`. **Un commit par unité**,
  conventional-commits (anglais) + `Co-Authored-By`.
- Pour chaque unité : `test-driven-development` (red→green→refactor), puis
  `verification-before-completion` (lint + typecheck + coverage + build + intégration + E2E
  conteneur) avant de déclarer « fait ».
- Fin de phase : `requesting-code-review`, corriger (`receiving-code-review`), **PR draft** →
  `main` (<200 mots, **sans lien de session**), ne pas merger sans validation.

### 5. Garde-fous (STOP si franchi)

1. **NE JAMAIS toucher la seedbox de prod.** Tout dev/test en local Docker + VM.
2. **NE JAMAIS toucher le legacy MySB** (lecture seule pour référence).
3. **Repo PUBLIC — zéro identité prod/perso** : fixtures neutres. Le hook pre-commit scanne
   désormais TOUS les chemins stagés ; ne le contourne pas. `HANDOFF.md` est git-ignoré.
4. **Budget CI GitHub Free** : qualité verrouillée en local. (⚠️ `pnpm ... | tail` masque le
   code retour en zsh.)
5. `any` interdit ; primitif nu au travers d'une frontière domaine interdit ; `exec`+string
   shell interdit. Installs apt : uniquement en conteneur/VM.
6. Toute action **irréversible** (force-push, suppression, réseau sortant réel) → **demande
   d'abord**. `bootstrap/install.sh` télécharge Node : en test, mirror/cached ou l'image
   Docker fournit déjà Node — l'E2E ne sort pas sur le réseau.

### 6. Dette / points d'attention connus

- **Le piège n°1 de cette phase : l'install qui brique** (issues #122/#100/#119…). Chaque
  étape doit être idempotente, reprenable, et ne JAMAIS casser SSH (le firewall Phase 3 a
  déjà son garde ; l'install de sshd_config durci doit avoir l'équivalent : validation
  `sshd -t` avant reload, rollback sinon).
- Conteneur : apt réel OK ; quotas ext4 et OpenVPN tunnels réels → VM Multipass
  (`docs/DEV.md`). L'E2E conteneur valide l'orchestration ; la VM valide le full-stack.
- `NetworkServiceAdapter.unitExists` tolère les unités absentes — après la Phase 4, sur une
  box installée, ce chemin ne doit plus jamais être pris : ajoute un mode strict
  (env/flag) que l'E2E d'install active.
- Le worker root devient une unité systemd installée (`kobox-worker.service`) — jusqu'ici
  les tests le lancent en `--once` ; conserve ce mode pour les tests.
- Quand tu as terminé, écris le prompt de la prochaine session (Phase 5 — Maintenance & Ops)
  avec le document lié, comme pour ce brief.
