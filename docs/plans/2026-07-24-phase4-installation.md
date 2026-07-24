# Phase 4 — Installation & Provisioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute in-session) with
> superpowers:test-driven-development for every task. One commit per task.

**Goal:** Make KoBox installable on a fresh Debian 12 box: the TypeScript orchestrator that
replaces `MySB.bsh` and its ~45 bash installers (AUDIT §1.1 + §3.6 + §6 phase 4) — pre-checks
before any mutation, dependency-ordered resumable install plan, component installers for the v1
core (sshd hardened, nginx, rtorrent/ruTorrent, bind9+dnscrypt, fail2ban, OpenVPN + easy-rsa PKI
bootstrap, Postfix, quota tools, sysctl tweaks), a `components` registry in DB, `kobox install`
idempotent at re-run, reversible `kobox uninstall`, the `kobox-firewall.service` boot oneshot
(Phase 3 debt #1) and `kobox-worker.service` — **the historical #1 pain (issues #122/#100/#119
"install bricks the server") is the enemy: every step idempotent, resumable, SSH never broken.**

**Architecture:** New hexagonal context `kobox/src/domain/installation/` (VOs, component catalog
+ dependency-ordered plan as pure functions, preflight evaluation, golden-tested rendering of
systemd units/sysctl/sshd drop-in/sources.list) / `application/installation/` (per-component
installer strategies + `RunInstallation`/`UninstallComponents` orchestrators) / infrastructure
adapters (`AptPackageAdapter` argv-only, `EasyRsaPkiAdapter`, `SystemFactsAdapter`,
`ArtifactFetchAdapter` sha256-verified). `kobox install` runs **direct as root** (bootstrap
problem: the worker unit does not exist yet); at the end it enqueues the convergence jobs of
Phases 1-3 (`apply-firewall`, `render-fail2ban`, `render-whitelist`, `render-openvpn`) and drains
them in-process. Reuses: `CommandRunner` (gains an optional argv-safe `env` field),
`ManagedFilesPort`, worker/jobs/`ChainHints`, `SecuritySettings`.

**Tech Stack:** TypeScript strict, Drizzle/SQLite WAL, Zod, vitest + fast-check, golden files,
Debian 12 systemd container (real apt/easy-rsa/sshd/nginx) for integration/E2E. No new runtime
dependency. The only irreducible bash: `kobox/bootstrap/install.sh` (~50 lines).

**Locked decisions honored:** no `any`, `readonly`, optional chaining; execFile argv-only (the
new `env` field keeps it argv-only — no shell ever); VOs at boundaries; declarative desired
state, idempotent, golden-tested; never `>` on an edited file; transactional/resumable installs
(no forced reboot, propagated exit codes, safe re-run); vendored ≠ rewritten (we install and
configure bind9, dnscrypt-proxy, fail2ban, OpenVPN, nginx, Postfix, rtorrent — the Phase 1-3
declarative renders become effective because the services finally exist); neutral fixtures; apt
installs only in container/VM; prod and legacy MySB untouched.

**Decisions taken by this plan (implementation choices, not re-litigated architecture):**

1. **pgl is `skipped` on Debian 12, honestly.** The legacy installs PeerGuardian from vendored
   Qt4-era `.deb`s (`install/PeerGuardian`: `${MySB_Files}/pgl*.deb` + libqt4 deps) — those do
   not exist on Debian 12. The registry gains a `skipped` state (with reason); the `pgl_in`
   firewall seam chain stays (harmless empty), rtorrent blocklist enforcement continues via the
   per-user `ipv4_filter` (Phase 2). An ipset-based native replacement is deferred to Phase 5
   (owner decision, noted in the Phase 5 brief).
2. **easy-rsa PKI in EC mode (`EASYRSA_ALGO=ec`, secp384r1) and `dh none`.** Avoids the
   multi-minute `gen-dh`, modern crypto, no VORACLE-era baggage. `VpnServerPaths` drops `dhPem`;
   the Phase 3 OpenVPN server render replaces `dh <path>` with `dh none` (goldens regenerated —
   justified: PKI bootstrap is explicitly Phase 4 scope and no locked decision names dh.pem).
3. **Files owned by stock packages:** on a fresh box the installer takes ownership of
   `/etc/bind/named.conf.local`, `/etc/bind/named.conf.options` and
   `/etc/dnscrypt-proxy/dnscrypt-proxy.toml` via `ManagedFilesPort` (diff-only writes);
   Postfix `main.cf` is edited **only** through `postconf -e` (argv-only, the sanctioned
   editor — never a file clobber); `/etc/apt/sources.list` is rendered **only** behind the
   opt-in `--manage-apt-sources` flag (anti-§5.2: never silently clobber an operator-edited
   file). `/etc/resolv.conf` is NEVER touched (legacy §5.2 pain; operator/Phase 5 decision).
4. **`kobox uninstall` never destroys data**: stops/disables KoBox units, removes KoBox-rendered
   files, resets the registry — never `userdel`, never `rm` under `/home`, never `apt purge`
   (packages stay; harmless). Anti-CleanAll by construction.
5. **ruTorrent per-user config + nginx htpasswd wiring are deferred to Phase 6** (portal/auth
   story). Phase 4 installs the app (verified archive), php-fpm and a secured-by-default vhost
   (auth_basic against an initially empty htpasswd = deny all).
6. **Quota activation requires `usrquota` already in fstab options**: the installer never edits
   `/etc/fstab` (brick risk #1); it installs the tools, activates quota when the mount is ready
   (`quotacheck`/`quotaon`), and otherwise prints exact operator guidance. VM validates the full
   path (container filesystems cannot).

**Out of scope (deferred):** cron/scheduler wiring, upgrades, backups, outbox mail, Let's
Encrypt (Phase 5); portal + per-user web auth (Phase 6); Samba/NFS/NextCloud/Minio/Webmin/
Seedbox-Manager/Cakebox/ShellInABox (Phase 5 vendored extras); prod data migration (post-6).

**Phase 3 debt settled here:** `kobox-firewall.service` boot oneshot (#1), easy-rsa PKI
bootstrap + create-user/delete-user → `render-openvpn` chaining (#2), minors (tc classid guard,
`fair_use_events.username` index, suspended user keeps tc class).

**Branch:** `feature/phase4-installation` from `main`.

---

## Task 1 — `CommandRunner` env support

**Files:**
- Modify: `kobox/src/infrastructure/system/CommandRunner.ts`
- Test: `kobox/test/unit/infrastructure/system/command-runner.test.ts` (create or extend)

**Specs:** `CommandRequest` gains `readonly env?: Readonly<Record<string, string>>`; the
`ExecFileRunner` merges it over `process.env` (never replaces — PATH must survive). Needed by
apt (`DEBIAN_FRONTEND=noninteractive`) and easy-rsa (`EASYRSA_*`). Still zero shell involvement.
Unit test: run `/usr/bin/env` (or `printenv`) with an injected var, assert it reaches the child
and PATH is intact; absent `env` behaves as before.

**Commit:** `feat(system): optional environment overlay on CommandRunner requests`

## Task 2 — Installation domain VOs

**Files:**
- Create: `kobox/src/domain/installation/ComponentName.ts`, `InstallState.ts`, `Version.ts`
- Test: `kobox/test/unit/domain/installation/*.test.ts`

**Specs:**
- `ComponentName.parse(raw)`: closed catalog — `kobox-core`, `apt-sources`, `sshd`, `tweaks`,
  `quota`, `nginx`, `rtorrent`, `rutorrent`, `bind`, `dnscrypt`, `pgl`, `fail2ban`, `openvpn`,
  `postfix`. `COMPONENT_NAMES` exported readonly tuple; unknown name throws `DomainError`.
- `InstallState`: `'to_install' | 'installed' | 'failed' | 'skipped'` union + parse; helpers
  `isPending()` (to_install or failed — a failed component re-runs, anti-#122).
- `Version.parse(raw)`: dotted numeric `X.Y[.Z]` + optional suffix (Debian package versions are
  looser — accept `[0-9][A-Za-z0-9.+~:-]*`, shell-safe charset, ≤64); `isNewerThan` NOT needed
  yet (YAGNI — upgrades are Phase 5); keep `value` + `equals`.

**TDD:** BDD-named unit tests per VO (fast-check for `Version` charset rejection), red → green.

**Commit:** `feat(installation): domain value objects (ComponentName, InstallState, Version)`

## Task 3 — Component catalog + dependency-ordered resumable plan (pure domain)

**Files:**
- Create: `kobox/src/domain/installation/catalog.ts`, `InstallPlan.ts`
- Test: `kobox/test/unit/domain/installation/InstallPlan.test.ts`

**Specs:**
- `catalog.ts`: `ComponentSpec { name: ComponentName; dependsOn: readonly ComponentName[] }` +
  `COMPONENT_CATALOG`: kobox-core (no deps, FIRST — dirs and units others rely on), apt-sources,
  sshd, tweaks, quota, dnscrypt, bind (dependsOn dnscrypt — forwarders target it), nginx,
  rtorrent, rutorrent (dependsOn nginx+rtorrent), pgl, fail2ban (dependsOn sshd), openvpn,
  postfix.
- `planInstallation(catalog, states: ReadonlyMap<string, InstallState>, requested?)`:
  deterministic topological order (stable by catalog order), returns only pending components
  (state absent/to_install/failed; `installed` and `skipped` are excluded), cycle detection
  throws, unknown dependency throws. `requested` narrows to a subset + its unmet deps.
- `planUninstall(catalog, states)`: reverse topological order of installed components.
- Unit tests: full-order snapshot; **resume scenario** (bind failed, everything before
  installed ⇒ plan = [bind, …after]); skipped stays skipped; cycle throws.

**Commit:** `feat(installation): component catalog with dependency-ordered resumable planning`

## Task 4 — Preflight (pure evaluation + system facts port)

**Files:**
- Create: `kobox/src/domain/installation/preflight.ts`, `ports.ts` (start: `SystemFactsPort`)
- Create: `kobox/src/infrastructure/system/SystemFactsAdapter.ts`
- Test: `kobox/test/unit/domain/installation/preflight.test.ts`,
  `kobox/test/integration/system/installation-adapters.int.test.ts` (facts section)

**Specs:**
- `SystemFacts { osId, osVersionId, arch, euid, rootFsType, hasDefaultRoute, hasTunDevice }`.
- `evaluatePreflight(facts, opts: { allowNonExt4: boolean }): readonly PreflightFailure[]` —
  pure; failures carry a one-line actionable message (French-free, neutral): requires
  `debian` 12, euid 0, arch `amd64|arm64` (arm64 = dev containers on Apple Silicon), root fs
  `ext4` unless `allowNonExt4` (container overlay), default route present. **Empty array =
  green; anything else and the orchestrator refuses to mutate anything.**
- `SystemFactsAdapter`: `/etc/os-release` parse, `process.geteuid()`, `uname -m`,
  `findmnt -n -o FSTYPE /`, `ip route show default` non-empty, `/dev/net/tun` existsSync.
  Integration test in container asserts real facts (debian/12, euid 0…).

**Commit:** `feat(installation): preflight checks that block before any mutation`

## Task 5 — Registry schema + repository (+ fair_use_events index debt)

**Files:**
- Modify: `kobox/src/infrastructure/persistence/schema.ts` (+ `components` table; + index on
  `fair_use_events.username`), generate migration with `pnpm drizzle-kit generate` (re-read the
  generated SQL — Phase 3 lesson: hand-check it)
- Create: `kobox/src/domain/installation/ports.ts` (add `ComponentRegistry`),
  `kobox/src/infrastructure/persistence/SqliteComponentRegistry.ts`,
  `InMemoryComponentRegistry.ts`
- Test: `kobox/test/integration/persistence/sqlite.test.ts` (extend)

**Specs:**
- `components`: `name` unique, `state` enum(to_install/installed/failed/skipped), `version`
  nullable, `reason` nullable (skip/fail detail), `installedAt` nullable, `updatedAt`. This is
  the KoBox successor of the legacy `services` registry (`inc/vars:304-382`).
- `ComponentRegistry { states(): Promise<ReadonlyMap<string, InstallState>>;
  get(name): Promise<ComponentRecord | undefined>; markInstalled(name, version?, now);
  markFailed(name, reason, now); markSkipped(name, reason, now); reset(name): Promise<void> }`.
- Integration: state transitions round-trip; re-marking updates `updatedAt`.

**Commit:** `feat(installation): component registry persistence and fair-use event index`

## Task 6 — Installation rendering (golden): units, sshd drop-in, sysctl, sources.list

**Files:**
- Create: `kobox/src/domain/installation/rendering.ts`
- Test: `kobox/test/unit/domain/installation/rendering.test.ts`
- Golden: `kobox/test/golden/installation/kobox-worker.service.golden`,
  `kobox-firewall.service.golden`, `sshd_config.d-90-kobox.conf.golden`,
  `sysctl.d-90-kobox.conf.golden`, `sources.list.golden`, `nginx-kobox.conf.golden`,
  `rutorrent-config.php.golden`, `named.conf.local.golden`, `named.conf.options.golden`,
  `dnscrypt-proxy.toml.golden`, `worker.env.golden`
- Modify: `kobox/src/domain/security/vpn.ts` (drop `dhPem`), `rendering.ts` (`dh none`),
  regenerate the three OpenVPN server goldens; `FsVpnPkiAdapter.serverPaths()`

**Specs (all pure `RenderedFile` producers, deterministic):**
- `renderWorkerUnit({ nodeBin, workerMain })` → `/etc/systemd/system/kobox-worker.service`
  0644: Type=simple, `ExecStart=<nodeBin> <workerMain>`, `EnvironmentFile=-/etc/kobox/worker.env`,
  Restart=on-failure, After=network.target, WantedBy=multi-user.target, User=root (the §3.5
  privileged consumer).
- `renderFirewallBootUnit()` → `/etc/systemd/system/kobox-firewall.service` 0644: Type=oneshot,
  `ConditionPathExists=/etc/kobox/firewall.rules`,
  `ExecStart=/usr/sbin/iptables-restore /etc/kobox/firewall.rules`, Before=network-pre.target,
  Wants=network-pre.target, WantedBy=multi-user.target — **the Phase 3 debt #1: rules survive
  reboot**.
- `renderWorkerEnv(vars: ReadonlyMap<string,string>)` → `/etc/kobox/worker.env` 0600 — sorted
  `KEY=value` lines; the installer snapshots the relevant `KOBOX_*` env at install time so the
  worker unit runs with the same configuration (incl. `KOBOX_STRICT_SERVICES=1`).
- `renderSshdDropin(sshPort)` → `/etc/ssh/sshd_config.d/90-kobox.conf` 0600: hardening that
  NEVER locks out: `PermitRootLogin prohibit-password`, `PasswordAuthentication yes` (users use
  passwords for SFTP chroot — legacy parity), `X11Forwarding no`, `MaxAuthTries 4`,
  `LoginGraceTime 30`, `ClientAliveInterval 300`, `ClientAliveCountMax 2`, `Port <sshPort>`
  emitted ONLY when ≠ 22 (drop-in must not fight the stock config).
- `renderSysctlTweaks()` → `/etc/sysctl.d/90-kobox.conf` 0644: conservative, container-appliable
  set (somaxconn, tcp_fin_timeout, tcp_tw_reuse, rmem/wmem_max, fs.inotify watches — the
  seedbox-relevant subset of legacy `install/Tweaks`, no GRUB/governor/fstab).
- `renderAptSources()` → `/etc/apt/sources.list` 0644: canonical Debian 12
  (deb.debian.org bookworm + bookworm-security + bookworm-updates, main contrib
  non-free-firmware). Applied only behind `--manage-apt-sources`.
- `renderNginxVhost({ portalPort })` → `/etc/nginx/conf.d/kobox.conf` 0644: listen
  `<portalPort> ssl`, snakeoil cert paths (ssl-cert package), `auth_basic` against
  `/etc/nginx/kobox.htpasswd`, `location /ru/` alias `/var/www/rutorrent/` + php-fpm socket
  fastcgi. Secure by default (empty htpasswd = deny).
- `renderRutorrentConfig()` → `/var/www/rutorrent/conf/config.php` 0640 root:www-data —
  global settings only (scgi defaults localhost, no per-user yet — Phase 6).
- `renderBindLocal()` → `named.conf.local` including `/etc/bind/kobox.zones.blacklists`;
  `renderBindOptions()` → `named.conf.options` (listen 127.0.0.1, forward only →
  `127.0.0.1 port 52`, dnssec-validation auto); `renderDnscryptConfig()` →
  `dnscrypt-proxy.toml` (listen `127.0.0.1:52`, require_dnssec, cache, no logs).
- OpenVPN server render: `dh <path>` → `dh none` (EC PKI); goldens regenerated via
  `UPDATE_GOLDEN=1`, diff reviewed.

**Commit:** `feat(installation): golden-tested rendering of units, hardening drop-ins and service configs`

## Task 7 — `PackagePort` + `AptPackageAdapter` + `ArtifactFetchPort`

**Files:**
- Create: ports in `kobox/src/domain/installation/ports.ts` (`PackagePort`,
  `ArtifactFetchPort`), `kobox/src/infrastructure/system/AptPackageAdapter.ts`,
  `ArtifactFetchAdapter.ts`, fakes `FakePackages.ts`, `FakeArtifactFetch.ts`
- Test: `kobox/test/unit/infrastructure/system/installation-adapters.test.ts` (recording
  runner), integration extension in `installation-adapters.int.test.ts`

**Specs:**
- `PackagePort { refresh(): Promise<void>; ensureInstalled(pkgs): Promise<void>;
  isAvailable(pkg): Promise<boolean>; isInstalled(pkg): Promise<boolean> }`.
- `AptPackageAdapter`: `dpkg-query -W -f '${db:Status-Status}' <pkg>` for installed;
  `ensureInstalled` filters already-installed then
  `apt-get install -y --no-install-recommends <pkgs…>` with
  `env: { DEBIAN_FRONTEND: 'noninteractive' }`, `timeoutMs 600_000`; `refresh` = `apt-get
  update` (called once per run by the orchestrator); `isAvailable` via `apt-cache policy`
  (`Candidate: (none)` ⇒ false). All argv-only. Fast idempotence: zero pending ⇒ zero apt call
  (unit-tested with recording runner).
- `ArtifactFetchPort { fetchVerified(url, sha256, destDir): Promise<string> }` —
  `ArtifactFetchAdapter` reuses the Phase 2 pattern (https + sha256, no redirects to http),
  writes to a temp file, verifies digest BEFORE moving into place (§5.6 verified downloads),
  returns the final path. Unpack stays in the installer (`tar -xzf` argv-only).
- Integration (container): `ensureInstalled(['zip'])` really installs; second call issues no
  apt command; `isAvailable('pgld')` false, `isAvailable('rtorrent')` true.

**Commit:** `feat(installation): apt package management and verified artifact fetch adapters`

## Task 8 — `EasyRsaPkiAdapter` (the Phase 3 PKI debt)

**Files:**
- Modify: `kobox/src/domain/security/ports.ts` (`VpnPkiPort` gains `ensurePki()`,
  `ensureClientMaterial(username)`, `removeClientMaterial(username)`),
  `kobox/src/infrastructure/system/fakes/FakeVpnPki.ts`
- Create: `kobox/src/infrastructure/system/EasyRsaPkiAdapter.ts` (extends the read side of
  `FsVpnPkiAdapter` by composition)
- Modify: `kobox/docker/Dockerfile` (+ `easy-rsa`)
- Test: unit (recording runner: exact argv/env sequences), integration (real EC PKI in
  container: init → CA → server → client alice → material readable → remove → undefined)

**Specs:**
- All easyrsa calls: `/usr/share/easy-rsa/easyrsa` argv-only with
  `env: { EASYRSA_BATCH: '1', EASYRSA_PKI: <dir>, EASYRSA_ALGO: 'ec', EASYRSA_CURVE:
  'secp384r1', EASYRSA_REQ_CN: … }`, `timeoutMs 120_000`.
- `ensurePki()`: idempotent — missing dir ⇒ `init-pki`; missing `ca.crt` ⇒ `build-ca nopass`;
  missing `issued/server.crt` ⇒ `build-server-full server nopass`. Never regenerates existing
  material (re-running install must not invalidate distributed client certs).
- `ensureClientMaterial(u)`: `build-client-full <u> nopass` only when absent; validates the
  username through the existing `Username` VO (already shell-safe).
- `removeClientMaterial(u)`: removes `issued/<u>.crt`, `private/<u>.key`, `reqs/<u>.req`
  (revocation lists = Phase 5; removal stops rendering profiles — delete-user parity).

**Commit:** `feat(security): easy-rsa EC PKI bootstrap adapter (Phase 3 debt)`

## Task 9 — VPN user lifecycle jobs (create/delete-user → PKI → render-openvpn)

**Files:**
- Create: `kobox/src/application/security/ProvisionVpnUser.ts`, `DeprovisionVpnUser.ts`
- Modify: `contract.ts` (`provision-vpn-user`/`deprovision-vpn-user` {username}),
  `JobWorker.ts` (execute + chain: after `create-user` also enqueue `provision-vpn-user`;
  after `delete-user` also `deprovision-vpn-user`; new hint `openVpnDirty` → `render-openvpn`),
  `useCases.ts`, `buildJob.ts`, `cli/main.ts`
- Test: `kobox/test/component/application/security/vpn-user.test.ts`,
  `worker-loop.test.ts` (extend), contract snapshot grows

**Specs:** `ProvisionVpnUser.execute({username})`: `ensureClientMaterial` → report
`{openVpnDirty: true}` (worker chains `render-openvpn`). `DeprovisionVpnUser`: remove material →
`{openVpnDirty: true}`. Missing PKI (openvpn component not installed) ⇒ the job fails loudly
(the chain is only enqueued on installed boxes; in dev containers without PKI the E2E env
provides one — asserted in component test with `FakeVpnPki`).

**Commit:** `feat(security): user VPN material lifecycle chained from create/delete-user`

## Task 10 — Component installer strategies

**Files:**
- Create: `kobox/src/application/installation/installers.ts` (or split files if >150 lines
  each): one `ComponentInstaller` per catalog entry + `InstallerContext`
- Create: `kobox/src/domain/installation/ports.ts` additions as needed
- Test: `kobox/test/component/application/installation/installers.test.ts` (fakes: packages,
  files, runner, registry, facts)

**Specs:**
- `interface ComponentInstaller { readonly name: ComponentName;
  install(): Promise<InstallOutcome>; uninstall(): Promise<void> }` with
  `InstallOutcome = { state: 'installed'; version?: string } | { state: 'skipped';
  reason: string }`.
- **kobox-core**: dirs (`/etc/kobox` 0755, `/var/lib/kobox` 0700, spool `1733`), render
  worker.env + both units, `systemctl daemon-reload`, `enable --now kobox-worker`,
  `enable kobox-firewall` (Condition guards the empty-rules case). Uninstall: stop/disable
  units, remove unit files + worker.env, daemon-reload.
- **sshd** (the never-break-SSH guard): ensure `openssh-server`; write drop-in via
  `ManagedFilesPort`; **`sshd -t` BEFORE reload — on failure remove the drop-in and throw**
  (rollback proven by component test + integration test with a poisoned render); on success
  `systemctl reload ssh`.
- **nginx**: pkgs `nginx php-fpm ssl-cert`; render vhost + ensure empty
  `/etc/nginx/kobox.htpasswd` (0640 root:www-data, never overwritten if present); `nginx -t`
  guard with the same remove-and-throw rollback; reload nginx.
- **tweaks**: render sysctl drop-in; `sysctl --system` (exit must be 0).
- **apt-sources**: only when `--manage-apt-sources`; render + `refresh()`; otherwise
  `skipped: 'operator-managed sources'`.
- **quota**: pkg `quota`; if `KOBOX_QUOTA_FS` set AND `findmnt` shows usrquota option:
  `quotacheck -ugm <fs>` + `quotaon <fs>`; else installed with actionable log line (tools
  ready, fstab guidance).
- **rtorrent**: pkg `rtorrent` (Debian 12 ships 0.9.8 — prod parity, end of build-from-source
  per Annexe B #95).
- **rutorrent**: pkgs `php-fpm php-cli unzip`; `fetchVerified(KOBOX_RUTORRENT_URL,
  KOBOX_RUTORRENT_SHA256, …)` → `tar -xzf` into `/var/www/rutorrent` (idempotent: skip when
  the tree exists with same version marker); render global config.
- **bind**: pkgs `bind9 bind9utils`; ensure the included blacklist zones file exists (empty
  render — `render-whitelist` owns the real content); render named.conf.local/options;
  `named-checkconf` guard (remove + throw on failure); `systemctl enable --now named` +
  `rndc reload`.
- **dnscrypt**: pkg `dnscrypt-proxy`; `systemctl disable --now dnscrypt-proxy.socket` (Debian
  socket-activation hijacks the listen address); render toml; `enable --now dnscrypt-proxy`.
- **pgl**: `isAvailable('pgld')`? on Debian 12 ⇒ `skipped: 'pgl not packaged for Debian 12
  (legacy used vendored Qt4 debs); ipset replacement deferred to Phase 5'`.
- **fail2ban**: pkg `fail2ban`; enable (not started in dev container — E2E keeps Phase 3
  rule); jail content arrives via chained `render-fail2ban`.
- **openvpn**: pkgs `openvpn easy-rsa`; `ensurePki()`; enable
  `openvpn-server@kobox-tun-gw|tun|tap`; start only when `facts.hasTunDevice` (container
  lacks /dev/net/tun — VM validates tunnels; asserted skip is logged).
- **postfix**: preseed via `debconf-set-selections` stdin (`postfix/main_mailer_type=Local
  only`, `postfix/mailname=<hostname>`); pkg `postfix`; `postconf -e
  inet_interfaces=loopback-only` (+ minimal hardening keys); `enable --now postfix`.
- Component tests cover: outcome per installer, sshd/nginx rollback paths, pgl skip reason,
  idempotent second run (no package/systemctl churn when converged).

**Commit:** `feat(installation): component installers for the v1 core stack`

## Task 11 — `RunInstallation` + `UninstallComponents` orchestrators

**Files:**
- Create: `kobox/src/application/installation/RunInstallation.ts`, `UninstallComponents.ts`
- Test: `kobox/test/component/application/installation/run-installation.test.ts`

**Specs:**
- `RunInstallation.execute({ allowNonExt4, manageAptSources })`:
  1. facts → `evaluatePreflight` → any failure ⇒ throw `PreflightFailedError` listing ALL
     failures (clear message BEFORE any mutation — component test proves zero port calls).
  2. `packages.refresh()` once.
  3. `planInstallation(catalog, await registry.states())` → for each component: run installer;
     success ⇒ `markInstalled` (with version when known); skip ⇒ `markSkipped`; throw ⇒
     `markFailed(reason)` and **stop** (deterministic, propagated exit code — no
     screen+busy-wait legacy §5.6); the next run resumes from the failed component (anti-#122).
  4. All green ⇒ enqueue convergence jobs (`apply-firewall`, `render-fail2ban`,
     `render-whitelist`, `render-openvpn`) and drain in-process (`JobWorker.drain()`).
  5. Return `InstallationReport { installed, skipped, alreadyInstalled, drainedJobs }`.
- `UninstallComponents.execute()`: reverse plan over installed components → `uninstall()` →
  `reset(name)`. Never touches `/home`, never removes packages (component test asserts the
  fake account/package ports were never called destructively).
- Component tests: happy path order, resume-after-failure, preflight-blocks-everything,
  idempotent re-run (second run = zero installer calls, still enqueues+drains convergence —
  convergence is cheap and idempotent by Phase 1-3 design).

**Commit:** `feat(installation): resumable install orchestrator and reversible uninstall`

## Task 12 — CLI (`kobox install`, `install-status`, `uninstall`) + composition

**Files:**
- Modify: `kobox/src/interfaces/cli/main.ts`, `composition.ts` (installation wiring:
  `buildInstallationUseCases`), `useCases.ts`
- Test: `kobox/test/component/interfaces/install-cli.test.ts` (invoke use cases through the
  same wiring path with fakes where possible), contract snapshot unchanged (install is direct,
  not a job)

**Specs:** `kobox install [--allow-non-ext4] [--manage-apt-sources]` (direct root execution —
prints per-component progress lines + final report, exit 1 on failure/preflight);
`kobox install-status` (registry as JSON); `kobox uninstall --yes` (refuses without the
explicit flag — irreversible-ish action stays deliberate). Composition builds installers with
real adapters; `KOBOX_INSTALL_DIR` (default `/opt/kobox`), `KOBOX_RUTORRENT_URL/_SHA256`
defaults pinned to the upstream release.

**Commit:** `feat(installation): kobox install/uninstall CLI commands`

## Task 13 — Strict services mode + minor Phase 3 debts

**Files:**
- Modify: `kobox/src/infrastructure/system/NetworkServiceAdapter.ts` (+ strict flag),
  `composition.ts` (`KOBOX_STRICT_SERVICES=1`), `TcShapingAdapter.ts` (classid guard),
  `kobox/src/application/security/EvaluateFairUse.ts` (suspended user unthrottle)
- Test: unit (adapter strict throw; classid >65534 loud error), component (suspended +
  throttled user gets unthrottled once)

**Specs:** strict mode: absent unit ⇒ throw (post-install this path must never be taken —
E2E install runs the whole convergence with strict on). Classid: uid > 65534 throws a clear
error instead of silently colliding (Debian seedbox uids start at 1000; the constraint is now
explicit). EvaluateFairUse: a suspended user with `level=throttled` is unthrottled and reset
(audit event appended), then skipped as before.

**Commit:** `fix(security): strict service mode, tc classid guard, suspended-user unthrottle`

## Task 14 — `bootstrap/install.sh` (the irreducible bash)

**Files:**
- Create: `kobox/bootstrap/install.sh` (~50 lines, `set -euo pipefail`)
- Test: `kobox/test/integration/system/bootstrap-script.int.test.ts` (`bash -n` syntax check +
  shellcheck when available + a --help/dry parse), E2E exercises it for real

**Specs:** root + debian pre-check (fail fast, clear message); Node ≥ 24 present ⇒ skip
NodeSource (the test/E2E path — no network for Node); else NodeSource setup + apt nodejs;
`corepack enable pnpm`; source dir = `KOBOX_SRC` if set (E2E: the mounted repo), else
`git clone $KOBOX_REPO /opt/KoBox`; `pnpm install --frozen-lockfile` + `pnpm build`;
`exec node dist/interfaces/cli/main.js install "$@"` — every following line is TypeScript.

**Commit:** `feat(bootstrap): minimal install.sh (pre-checks, Node, clone, exec kobox install)`

## Task 15 — Integration tests (real apt/easy-rsa/sshd/facts in container)

**Files:**
- Create/extend: `kobox/test/integration/system/installation-adapters.int.test.ts`
- Modify: `kobox/docker/Dockerfile` (easy-rsa — done in Task 8), `docker/e2e-setup.sh` if
  fixtures needed

**Specs (root+linux gated like every system suite):** apt adapter (zip install → installed →
second call no-op → remove via `apt-get remove` NOT exposed by port — assert only via dpkg);
easy-rsa full EC PKI cycle; sshd guard: poisoned drop-in ⇒ `sshd -t` fails ⇒ file removed,
error thrown, stock sshd config still valid; SystemFacts real values; bootstrap script
`bash -n`.

**Commit:** `test(installation): integration coverage against real apt, easy-rsa and sshd`

## Task 16 — E2E: virgin Debian 12 → bootstrap → full stack green

**Files:**
- Create: `kobox/test/e2e/installation.e2e.test.ts` (sequential)
- Modify: `docker/e2e-setup.sh` (rutorrent fixture archive served by the local https fixture,
  hosts entry reuse), `docs/DEV.md`

**Scenario (the historical done criterion):**
1. `bootstrap/install.sh` with `KOBOX_SRC=/opt/KoBox/kobox`, Node present,
   `KOBOX_RUTORRENT_URL` → local fixture tarball (no external network beyond apt),
   `--allow-non-ext4`, `KOBOX_STRICT_SERVICES=1` in the install env → exit 0.
2. Registry: every component `installed` except `pgl=skipped` (+ `apt-sources=skipped` —
   flag not passed) ; `kobox install-status` JSON asserts it.
3. Units: `kobox-worker` **active** (real systemd worker now — the --once test mode remains
   for other suites), `kobox-firewall` enabled, nginx/named/dnscrypt-proxy/postfix active,
   fail2ban enabled + `fail2ban-client -t` green, `sshd -t` green.
4. Convergence ran strict: firewall applied (sentinel chain live), whitelist/fail2ban/openvpn
   files rendered; OpenVPN: EC PKI on disk (ca.crt + server.crt), 3 server configs with
   `dh none`, zero `comp-lzo`.
5. `kobox create-user alice` (queue) → **the installed worker service** processes it (poll
   registry/job status, no --once): account + rtorrent unit active + VPN client profile
   rendered from real PKI + firewall re-applied.
6. Boot persistence: `iptables -F INPUT` (flush) → `systemctl start kobox-firewall` → rules
   restored (sentinel back).
7. Idempotence: re-run `kobox install` → exit 0, registry unchanged, no reinstalls (fast).
8. `kobox uninstall --yes` → KoBox units gone/disabled, rendered files removed, registry
   reset, `/home/alice` still present (delete-user was NOT run), sshd still healthy.

**Commit:** `feat(installation): full-stack E2E — fresh Debian 12 to green stack via bootstrap`

## Task 17 — Docs, verification, review, PR, Phase 5 brief

- `docs/DEV.md`: install E2E env vars, easy-rsa note, strict mode, rutorrent fixture.
- `verification-before-completion`: `pnpm lint && pnpm typecheck && pnpm coverage` (≥85 %
  domain+application) && `pnpm build` && `make test-int` && `make e2e` — full outputs read, no
  `| tail`.
- `requesting-code-review` → fix (`receiving-code-review`).
- Write `docs/PHASE-5-BRIEF.md` (Maintenance & Ops: upgrades transactionnels, cron/scheduler
  26-line parity, backups, outbox mail, Let's Encrypt, vendored extras, pgl/ipset decision).
- Draft PR to `main` (<200 words, no session link). Do not merge.

**Commits:** `docs(dev): phase 4 environment and E2E notes`, `docs: add Phase 5 implementation brief`
