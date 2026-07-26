# Phase 7 — Migration & Cutover Implementation Plan

> **For Claude:** Execute task-by-task with TDD (red → green → refactor), one commit per task,
> `verification-before-completion` before each commit. This session implements directly (the
> Phase 7 brief prescribes "un commit par unité", not subagent dispatch).

**Goal:** Import the 8 live MySB users (MariaDB control-plane + per-user sync sqlite) into
KoBox's single SQLite store, idempotently and dry-run-by-default, so KoBox can regenerate all
files from imported data; plus close the deferred easy-rsa CRL debt and document the cutover.

**Architecture:** Hexagonal. A read-only `MysbSourcePort` (infra adapter reads a *dump directory*
of SQLite files, never a live MariaDB connection) feeds an `ImportFromMysb` application use case.
Pure `domain/migration` mappers turn parsed rows → existing VOs/aggregates. The use case reuses
existing repos (all idempotent upserts) + `CreateUser` (extended for explicit ports + must-change)
and enqueues the existing provisioning jobs. Desired-state: import **data**, KoBox **regenerates**
files. Zod at the import boundary (mirrors `application/jobs/contract.ts`).

**Tech Stack:** TypeScript strict (no `any`, readonly ctor fields, optional chaining), better-sqlite3
+ drizzle, commander CLI, zod, vitest pyramid (unit/component/contract/integration/e2e), Debian 12
container E2E.

---

## Locked decisions (this plan)

1. **Password strategy = temp password mailed + forced reset at first login** (owner, 2026-07-26).
   → migration `0007` adds `portal_credentials.must_change_password`; migration generates a temp
   password per user, hashes it (account + portal), enqueues a mail **with** the temp password
   directly to the outbox (cleartext lives only in `mails.body`, never in the jobs DB), and sets
   `must_change_password=1`. Portal forces `/password` before any other route until changed.
2. **Dump format = a directory of SQLite files** (matches brief §3 "integration: import vs vraie
   SQLite depuis un dump fixture"):
   - `<dump>/mysb.sqlite` — mirrors the MariaDB `MySB_db` tables we read: `users`,
     `users_rtorrent_cfg`, `users_addresses`, `trackers_list`, `trackers_list_ipv4`, `blocklists`,
     `torrents`.
   - `<dump>/sync/<username>.sq3` — per-user sync sqlite (table `categories.sync_mode`).
   The adapter reads both via better-sqlite3. Live MariaDB read is **out of scope** (deferred);
   `CUTOVER.md` documents the read-only export recipe (mysqldump → sqlite).
3. **User creation = direct `CreateUser.execute` (not a `create-user` job)**, then migration
   enqueues `provision-rtorrent` + `provision-vpn-user` + `render-nfs-exports` itself (the same
   fan-out the worker's create-user chain does) and sends its own temp-password mail. Rationale:
   the worker's generic welcome mail carries no password; calling `CreateUser` directly means it
   does not fire, so no suppression flag is needed.
4. **Port preservation:** `CreateUser` gains optional explicit `ports`; `PortAllocatorPort` gains
   `claim*` to seed the `allocated_ports` ledger with legacy ports 51101→51117 so later
   allocations skip them. Preserving rtorrent ports keeps in-flight torrents alive (brief §6).
5. **Flags:** `sync_disabled ← (categories.sync_mode == 0)`. `allow_public_tracker` has **no** prod
   DB source (dead file patch, §5) → default `false`; documented as post-migration toggle. Import
   is faithful to the dump (no silent drift-fixing); known user-f drift noted in `CUTOVER.md`.
6. **Tracker certs:** import tracker identity only (host/proto/port/privacy/flags), set
   `check_state='pending'`, `cert_expiration=null` → KoBox re-fetches real certs (regeneration).
   Avoids importing the legacy −2-day-skewed value.
7. **Re-entrancy:** every write is an idempotent upsert or guarded by existence check; a re-run is
   a no-op. No surrounding transaction needed (repos own their own).

---

## Task 1 — Explicit port claim (preserve legacy SCGI/rtorrent ports)

**Files:**
- Modify: `src/domain/user/PortAllocatorPort.ts` (add `claimScgiPort`/`claimRtorrentPort`)
- Modify: `src/infrastructure/persistence/SqlitePortAllocator.ts`
- Modify: `src/infrastructure/persistence/InMemoryPortAllocator.ts` (if present) / test fakes
- Modify: `src/domain/user/errors.ts` (or nearest) — `PortAlreadyClaimedError`
- Modify: `src/application/user/CreateUser.ts` (+ `CreateUserCommand.ports?`)
- Test: `test/unit/domain/...` (allocator claim), `test/integration/persistence/sqlite.test.ts`
  (real claim + conflict), `test/component/application/user/user-lifecycle.test.ts` (CreateUser
  with explicit ports)

**TDD:**
1. RED: integration test — `allocator.claimScgiPort(ScgiPort.parse(51101))` inserts a row in
   `allocated_ports`; a second claim of the same port throws `PortAlreadyClaimedError`; a
   subsequent `allocateScgiPort()` returns 51102 (skips the claimed one).
2. GREEN: add `claim*` to the port + impl (INSERT within the existing `immediate` tx; catch the
   UNIQUE violation → throw typed error — mirror the sync-throw caveat from Phase 5 memory).
3. RED: component test — `CreateUser.execute({ ...command, ports: { scgi, rtorrent } })` writes a
   user whose ports equal the explicit ones AND seeds the ledger; compensation on later failure
   releases them; omitting `ports` keeps today's allocate-next-free behavior.
4. GREEN: in `CreateUser`, when `command.ports` present, `claim*` instead of `allocate*`; keep the
   existing release-on-failure compensation.
5. Verify + commit: `feat(migration): claim explicit ports to preserve legacy SCGI/rtorrent ports`

---

## Task 2 — `must_change_password` (forced reset at first login)

**Files:**
- Create: `drizzle/0007_phase7-must-change-password.sql` (via `drizzle-kit generate`)
- Modify: `src/infrastructure/persistence/schema.ts` (`portalCredentials.mustChangePassword`)
- Modify: `src/domain/portal/ports.ts` (`PortalCredentials` + `PortalCredentialsPort.save`)
- Modify: `src/infrastructure/persistence/SqlitePortalCredentialsRepository.ts`
- Modify: `src/infrastructure/persistence/InMemoryPortalCredentialsRepository.ts`
- Modify: `src/application/user/CreateUser.ts` (`command.mustChangePassword?` → `credentials.save`)
- Modify: `src/application/user/ChangePassword.ts` (clear the flag on success)
- Modify: portal auth flow (`src/application/portal/Authenticate*` and
  `src/interfaces/http/...`) — expose `mustChange`; add a preHandler that forces `/password`
- Test: integration (repo round-trip), component (CreateUser sets / ChangePassword clears),
  portal component + e2e (interception: authenticated must-change user is redirected to
  `/password` for every route except `/password`, `/logout`, static assets)

**TDD:** schema+migration first (regenerate), then repo round-trip test, then CreateUser/
ChangePassword flag behavior, then the portal preHandler interception (read the Phase 6 portal
route registration + session/Authenticate before writing this — the map located them under
`src/interfaces/http/` and `src/application/portal/`).

**Note:** default is `0` (existing users unaffected). Commit:
`feat(portal): force password reset at first login via must_change_password`

---

## Task 3 — `MysbSourcePort` + SQLite dump reader + neutral fixture builder

**Files:**
- Create: `src/application/migration/MysbSourcePort.ts` (port + typed row DTOs)
- Create: `src/application/migration/mysbSchemas.ts` (zod boundary schemas, regex reused from
  domain `*_PATTERN` constants — mirror `src/application/jobs/contract.ts`)
- Create: `src/infrastructure/persistence/SqliteMysbDumpSource.ts` (better-sqlite3 reads
  `mysb.sqlite` + `sync/<user>.sq3`; `.parse()` each row at the boundary)
- Create: `test/fixtures/migration/buildDump.ts` (neutral dump generator: creates the sqlite
  files with neutral rows — RFC 2606 domains / RFC 5737 IPs / placeholder usernames)
- Test: `test/unit/application/migration/mysbSchemas.test.ts` (parse OK / reject malformed),
  `test/integration/persistence/mysb-dump-source.test.ts` (read a real generated fixture dump)

**TDD:** unit (schema parse + rejection) → integration (adapter reads fixture). The fixture
builder doubles as the documented dump schema. Commit:
`feat(migration): read-only MysbSourcePort over a SQLite dump directory`

---

## Task 4 — Prod→VO mappers (`domain/migration`)

**Files:**
- Create: `src/domain/migration/mappers.ts` (pure functions; live under `domain/**` so they count
  toward the 85% coverage gate)
- Test: `test/unit/domain/migration/mappers.test.ts`

**Mappers:**
- `toUserImport(userRow, rtorrentCfgRow, syncMode)` → `{ username, email, accountType, quota,
  scgiPort, rtorrentPort, proxyPort, status, syncDisabled }` (VOs constructed; `syncDisabled =
  syncMode === 0`).
- `toTracker(trackerRow, ipv4Rows)` → `Tracker.restore({ ..., checkState: pending, ipv4,
  certExpiry: undefined })`.
- `toBlocklist(row)` → `Blocklist.restore(...)`.
- `toTorrent(row)` → `{ username, torrent: Torrent.restore(...) }` (state mapped to
  `loaded|completed|rejected`).
- `toAddress(row)` → `{ username, ip }` or `{ username, hostname }` (DynDNS vs static).

**TDD:** one `should_...` test per mapper incl. edge cases (missing label, dead tracker, hostname
vs ipv4, sync_mode 0/2). Commit: `feat(migration): pure prod→VO mappers`

---

## Task 5 — `ImportFromMysb` use case

**Files:**
- Create: `src/application/migration/ImportFromMysb.ts` (+ `MigrationReport`)
- Create: `src/application/migration/errors.ts` if needed
- Test: `test/component/application/migration/import-from-mysb.test.ts`

**Behavior:**
- `execute({ apply }): Promise<MigrationReport>`.
- Read all source rows via `MysbSourcePort`.
- Per user (skip if `repo.findByUsername` exists → report `alreadyImported`):
  - dry-run: add to `report.wouldCreateUsers`.
  - apply: generate temp password (`randomBytes`), hash (`PasswordHasherPort`), `CreateUser.execute`
    with explicit `ports` + `mustChangePassword: true`; pre-write `torrent_instances` row with
    flags (`TorrentInstance.restore`, `instances.save`) **before** enqueuing provisioning so
    `provision-rtorrent` preserves the flags; enqueue `provision-rtorrent`, `provision-vpn-user`,
    `render-nfs-exports`; enqueue temp-password mail directly to `outbox` (cleartext never in the
    jobs DB); import that user's addresses.
- Global (once): upsert trackers (+ipv4), blocklists, torrents (batched); on apply, enqueue
  `render-whitelist`, `update-blocklists`/`apply-ipset`, `apply-firewall` to reflect imported data.
- `MigrationReport`: `{ apply, users: {created|alreadyImported|conflicts}, trackers, blocklists,
  torrents, addresses }` counts + lists.

**TDD (component, fakes + in-memory repos):** dry-run writes nothing; apply creates users with
preserved ports + flags + must-change creds + a queued mail + provisioning jobs; **re-run = no-op**;
a user with an unparseable row → `conflicts`, others still imported. Commit:
`feat(migration): ImportFromMysb use case (idempotent, dry-run default)`

---

## Task 6 — CLI command `migrate-from-mysb` + composition wiring

**Files:**
- Modify: `src/interfaces/cli/main.ts` (register
  `migrate-from-mysb --dump <dir> [--dry-run] [--apply]`; **dry-run is default**, mutate only when
  `options.apply === true`; JSON report to stdout; `finally c.db.close()`)
- Modify: `src/interfaces/composition.ts` (`export function buildMigrateFromMysb(c, { dumpDir })`
  next to `buildInstallation`/`buildUpgrade`; constructs `SqliteMysbDumpSource` + wires the use
  case from container repos/hasher/outbox/queue)
- Test: covered by the E2E (Task 9) + component (Task 5)

**Guard:** invalid/missing dump dir → throw (exit 1). Commit:
`feat(cli): migrate-from-mysb command (dry-run default, --apply to write)`

---

## Task 7 — easy-rsa CRL revocation (deferred debt #1)

**Files:**
- Modify: `src/infrastructure/system/EasyRsaPkiAdapter.ts` (`removeClientMaterial`: `revoke` +
  `gen-crl` before the `rm`, reusing the private `easyrsa()` funnel)
- Modify: `src/domain/security/vpn.ts` (`VpnServerPaths.crlPem`; `renderOpenVpnServer` emits
  `crl-verify <crlPem>`)
- Modify: `src/infrastructure/system/FsVpnPkiAdapter.ts` (`serverPaths().crlPem = join(baseDir,
  'crl.pem')`)
- Modify: `src/domain/security/ports.ts` + `src/infrastructure/system/NetworkServiceAdapter.ts`
  (`reloadOpenVpn()` — `reload-or-restart openvpn-server@kobox-<variant>`, gated by `unitExists`)
- Modify: `src/application/security/RenderOpenVpn.ts` (call `reload.reloadOpenVpn()` when
  `changedFiles.length > 0` — the intended relaxation of the "no restart" stance for a CRL change)
- Modify: fakes `FakeVpnPki.ts`, `FakeNetworkServices.ts`; regenerate `test/golden/security/*.golden`
- Test: `test/unit/infrastructure/system/easyrsa-pki.test.ts` (revoke+gen-crl argv),
  `test/unit/domain/security/vpn-rendering.test.ts` (crl-verify golden),
  `test/component/application/security/vpn-user.test.ts` (deprovision revokes),
  `test/e2e/security-network.e2e.test.ts` (crl.pem exists + server conf has crl-verify)

**TDD:** argv assertion → golden regen → component → e2e. Commit:
`feat(security): revoke client certs to a published CRL on user deletion`

---

## Task 8 — Integration test: import from a real SQLite dump fixture

**Files:**
- Test: `test/integration/persistence/import-from-mysb.int.test.ts` (or `test/integration/migration/`)

**Behavior:** generate a neutral dump (Task 3 builder), open a real temp KoBox DB
(`KoboxDatabase.open`), run `ImportFromMysb` with real Sqlite repos + fakes for system ports,
`--apply`, assert the KoBox tables (`users`, `allocated_ports`, `torrent_instances`, `trackers`,
`blocklists`, `torrents`, `user_addresses`, `portal_credentials.must_change_password`) hold the
mapped rows; re-run asserts no duplicates. Commit:
`test(migration): integration import from a real SQLite dump fixture`

---

## Task 9 — E2E: `migrate-from-mysb.e2e.test.ts`

**Files:**
- Test: `test/e2e/migrate-from-mysb.e2e.test.ts` (mirror `installation` + `portal-access` specs)
- Modify: `docker/e2e-setup.sh` if the dump references any fixture host aliases

**Flow (Debian-as-root gate):** stage a neutral dump into the container → `kobox install`
(base system, PKI, worker) → `kobox migrate-from-mysb --dump <dir> --apply` → drain the worker
(`node WORKER` until quiet) → boot portal → an imported user logs in, is **forced to /password**,
sets a new password, then sees ruTorrent (`/ru/`) and downloads `.ovpn` (`remote vpn.example.org`);
per-user nginx `/RPC-<USER>` include present. Commit:
`test(migration): container E2E dump → migrate → install → portal login`

---

## Task 10 — `docs/CUTOVER.md`

**Files:** Create `docs/CUTOVER.md`.

**Contents:** exact ordered runbook — freeze MySB → read-only dump recipe (mysqldump of the 7
tables → sqlite; copy `~/db/*.sq3`) → `migrate-from-mysb --dry-run` review → target `kobox install`
→ `migrate-from-mysb --apply` → drain worker / regenerate → smoke checks → atomic nginx `:8189`
switch (coexistence `/opt/kobox` vs `/opt/MySB`, one active) → rollback window. Document the
temp-password mail window (run `send-mails` promptly), the known user-f `sync_mode` drift, and that
`allow_public_tracker` is a post-migration toggle. **No prod write happens without explicit owner
GO.** Commit: `docs: cutover runbook (freeze → dump → import → switch → rollback)`

---

## End of phase

- `requesting-code-review`; open a **draft** PR (<200 words, no session link, English,
  conventional-commit title, `Co-Authored-By`). Do **not** merge; do **not** touch prod.
- Update project memory; write the next-session prompt (post-cutover hardening / v1.1 backlog:
  portal composition split + `EnvironmentFile` + `ProtectSystem=strict` (§0 debt #4), Webmin/SM/
  Cakebox as install components, NordVPN client #47) with a linked brief, as for this phase.
