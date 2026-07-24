# Phase 1 — Torrent Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute in-session) with
> superpowers:test-driven-development for every task. One commit per task.

**Goal:** Implement the Torrent Lifecycle bounded context: per-user rTorrent instance provisioning
(systemd unit — Phase 0 debt), declarative idempotent rendering of `.rtorrent.rc`/hooks (ends the
destructive regeneration), typed torrent-event pipeline (shim → spool → typed job → use case), and
first-class DB flags `allow_public_tracker` / `sync_disabled` replacing the two prod file patches.

**Architecture:** New hexagonal context `kobox/src/domain/torrent/` (VOs + `TorrentInstance`
aggregate + pure rendering) / `application/torrent/` (use cases) / infrastructure adapters
(filesystem apply write-if-changed, systemd unit install, bencode metainfo, SCGI-XMLRPC control,
spool inbox). Unprivileged event path: rtorrent hook shim (5 lines, zero logic) → `kobox
torrent-event` writes a JSON file into a `1733` spool dir → root worker sweeps, derives the
username from the file owner (anti-spoofing), re-validates with Zod, enqueues a typed job.
User Management → Torrent coupling stays event-ish: the worker chains `provision-rtorrent` after
`create-user` and `deprovision-rtorrent` after `delete-user`.

**Tech Stack:** TypeScript strict, Drizzle/SQLite (WAL), Zod, vitest + fast-check, golden files,
Debian 12 systemd container (real `rtorrent` package) for integration/E2E.

**Locked decisions honored:** no `any`, `readonly`, optional chaining, execFile argv-only, VOs at
every domain boundary, worker-root privilege model, idempotent declarative rendering
(never `>` over an edited file; user drop-ins `~/rtorrent/config.d/99-*.rc` are never touched),
public repo → neutral fixtures only, quality gates local (pre-commit/pre-push hooks).

**Out of scope (deferred):** announcer certificate checks & tracker whitelist (Phase 2 — but
`Announcer` VO + metainfo parsing land now), fair-use/metering (Phase 3), portal (Phase 6),
warm-daemon socket for events (spool + CLI spawn is fine at ~100 ev/min; escape hatch documented).

**Branch:** `feature/phase1-torrent-lifecycle` from `main`.

---

## Task 1 — Domain VOs (`InfoHash`, `Label`, `WatchDir`, `SessionDir`, `TorrentState`, `EventHook`, `Announcer`)

**Files:**
- Create: `kobox/src/domain/torrent/InfoHash.ts`, `Label.ts`, `WatchDir.ts`, `SessionDir.ts`,
  `TorrentState.ts`, `EventHook.ts`, `Announcer.ts`
- Test: `kobox/test/unit/domain/torrent/*.test.ts` (one per VO)

**Specs:**
- `InfoHash.parse(raw)`: exactly 40 hex chars, normalized to uppercase. fast-check properties:
  parse(valid) round-trips uppercased; non-hex/wrong-length always throws (`InvalidInfoHashError`
  extends `DomainError`).
- `Label.parse(raw)`: `/^[a-z0-9][a-z0-9._-]{0,63}$/` — path-safe and shell-safe by construction
  (used in rendered paths and execFile argv), no leading dot. `equals`.
- `WatchDir.root()` / `WatchDir.labeled(label)`: exposes `watchPath(home)`,
  `completePath(home)`, `torrentsPath(home)` (`~/rtorrent/watch[/label]` etc.), `label?: Label`.
- `SessionDir.forHome(home)`: `<home>/rtorrent/.session/` (value object with `.value`).
- `TorrentState`: closed enum VO (`loaded | completed | rejected`) with `parse` (erased = row gone).
- `EventHook`: closed set for `inserted_new | finished | erased`; each exposes `shimFilename`
  (`.rTorrent_<type>.sh`), `rcEventKey` (`event.download.<type>`), `rtorrentArgs` (the `$d.*=`
  list the rc binds — mirrors legacy templates).
- `Announcer.parse(url)`: proto ∈ {http, https, udp}, extracts `host` (validated
  `/^[a-z0-9.-]+$/i`, strips creds/port/path), keeps `url`. Throws on other protocols.

**TDD steps:** For each VO: write failing unit test (BDD-ish names, fast-check for `InfoHash` and
`Label`) → run `pnpm test:unit` (fail) → implement → run (pass). Style-match Phase 0 VOs
(`private constructor` + `static parse`, branded where identically-shaped).

**Commit:** `feat(torrent): domain value objects for the torrent lifecycle context`

## Task 2 — `TorrentInstance` aggregate + domain events + ports

**Files:**
- Create: `kobox/src/domain/torrent/TorrentInstance.ts`, `events.ts`, `ports.ts`, `Torrent.ts`
- Modify: `kobox/src/domain/user/ports.ts` (extend `ServiceControlPort`)
- Test: `kobox/test/unit/domain/torrent/TorrentInstance.test.ts`

**Specs:**
- `TorrentInstance` (aggregate root, one per user): `username`, `scgiPort`, `rtorrentPort`,
  `watchDirs: readonly WatchDir[]` (root always present), `allowPublicTracker: boolean`,
  `syncDisabled: boolean`, optional `id`. Immutable style like `SeedboxUser`
  (`provision()` static + `restore()` + `props()`).
  - `provision({username, scgiPort, rtorrentPort})` → `{instance, event: RtorrentInstanceProvisioned}`,
    flags default `false`, watchDirs = `[WatchDir.root()]`.
  - `addWatchDir(label)` → idempotent: existing label returns `{instance: this}` (no event);
    else new instance + `WatchDirAdded` event.
  - `setAllowPublicTracker(v)` / `setSyncDisabled(v)` → new instance (no-op when unchanged).
  - **Policy:** `admitTorrent(privacy: 'private' | 'public'): 'accepted' | 'rejected-public-tracker'`
    — public accepted only when `allowPublicTracker`.
- `Torrent` (entity, per instance): `infoHash`, `name: string` (non-empty), `state: TorrentState`,
  `label?: Label`, `tree?: string`; `load()`, `complete(tree)`, `reject()` transitions.
- `domain/torrent/ports.ts`:
  ```ts
  TorrentInstanceRepository { findByUsername; save; delete }
  TorrentRepository { findByInfoHash(username, infoHash); upsert(username, torrent); delete(username, infoHash); countFor(username) }
  RtorrentConfigPort { apply(files: readonly RenderedFile[]): Promise<readonly string[]> } // changed paths
  WatchDirPort { ensureLayout(username: Username, watchDirs: readonly WatchDir[]): Promise<void> }
  TorrentMetainfoPort { read(path: string): Promise<TorrentMetainfo | undefined> } // undefined = no/unreadable file
  RtorrentControlPort { stopAndClose(scgiPort: ScgiPort, hash: InfoHash): Promise<void> }
  UserScriptRunnerPort { runFinishedScripts(username: Username, args: FinishedScriptArgs): Promise<void> }
  ```
  `RenderedFile = { readonly path; readonly content; readonly mode; readonly owner; readonly group }`;
  `TorrentMetainfo = { readonly infoHash: InfoHash; readonly name: string; readonly isPrivate: boolean; readonly announcers: readonly Announcer[] }`.
- Extend Phase 0 `ServiceControlPort` (domain/user/ports.ts) with:
  `installUserService(username, unitContent): Promise<void>` (write-if-changed + daemon-reload +
  enable), `removeUserService(username): Promise<void>`, `restartUserService(username): Promise<void>`.
  (Update `FakeServiceControl` in Task 4.)

**Commit:** `feat(torrent): TorrentInstance aggregate, torrent entity, context ports`

## Task 3 — Declarative rendering + golden files (the heart: ends §5.2)

**Files:**
- Create: `kobox/templates/rtorrent/rtorrent.rc.tmpl`, `80-watch.rc.tmpl`, `event-shim.sh.tmpl`,
  `rtorrent-user.service.tmpl` (KoBox-owned, neutral — no legacy banner)
- Create: `kobox/src/domain/torrent/rendering.ts` (pure), `kobox/src/infrastructure/templates/TemplateProvider.ts`
- Test: `kobox/test/unit/domain/torrent/rendering.test.ts` + golden files under
  `kobox/test/golden/rtorrent/` (`rtorrent.rc.golden`, `80-watch.rc.golden`,
  `shim-inserted_new.sh.golden`, `shim-finished.sh.golden`, `shim-erased.sh.golden`,
  `rtorrent-user.service.golden`)

**Specs:**
- Template syntax `{{name}}`; pure `renderTemplate(template, vars)` throws on unknown or leftover
  placeholder (no silent drift). Pure `renderInstanceFiles(instance, home, settings): RenderedFile[]`
  where `settings = { koboxBin: string }`. Produces:
  - `<home>/.rtorrent.rc` (mode 0640 root:<user>) — modernized legacy semantics: cfg.* method
    inserts, `system.daemon.set = true` (systemd Type=simple, no screen/tty), SCGI
    `127.0.0.1:{{scgi_port}}`, `port_range {{rtorrent_port}}-{{rtorrent_port}}`, SSL
    `ssl_verify_peer/host = 1` + `capath=/etc/ssl/certs` (signature feature), session dir via
    `SessionDir`, logs, `pieces.memory.max.set = 512M`, DHT/PEX/UDP off, encryption required,
    the three `method.set_key = event.download.*` bindings to `~/.rTorrent_<type>.sh` with the
    legacy `$d.*=` args, config.d `.import` mechanism (drop-ins survive; KoBox never writes
    `99-*.rc` — that's the persistent user hook).
  - `<home>/rtorrent/config.d/80-watch.rc` (0640) — root watch schedule + one per label
    (`d.custom1.set=<label>`), exact legacy `schedule2 = watch_directory_N,5,5,...` shape.
  - Three shims `<home>/.rTorrent_<type>.sh` (0750 root:<user>) — 5 lines, zero logic:
    `#!/bin/sh` + comment "KoBox-managed, do not edit — behavior flags live in the DB" +
    `exec {{kobox_bin}} torrent-event <type> --hash "$1" ...` (args per `EventHook.rtorrentArgs`).
  - `/etc/systemd/system/rtorrent-<user>.service` (0644 root:root) — `User=<user>`,
    `ExecStart=/usr/bin/rtorrent -n -o import=<home>/.rtorrent.rc`, `Restart=on-failure`,
    `WantedBy=multi-user.target`.
- **Idempotence property test:** rendering twice with same inputs is byte-identical.
- **Golden tests:** render for fixture user `alice` (scgi 51101, rtorrent 45001, labels
  `films`, `series`) and compare byte-for-byte to goldens; `UPDATE_GOLDEN=1 pnpm test:unit`
  rewrites them (documented in the test header).
- `TemplateProvider` (infrastructure): loads `kobox/templates/rtorrent/*.tmpl` synchronously at
  composition time; rendering module receives template strings (domain stays dependency-free).

**Commit:** `feat(torrent): declarative golden-tested rendering of rtorrent config, hooks, unit`

## Task 4 — Infrastructure adapters + fakes

**Files:**
- Create: `kobox/src/infrastructure/system/RtorrentConfigAdapter.ts` (fs write-if-changed +
  chown/chmod via execFile `install`/`chown`), `WatchDirAdapter.ts` (execFile
  `install -o <user> -g kobox-users -m <mode> -d`), `BencodeMetainfoAdapter.ts` (no-dep bencode
  decoder + sha1 via `node:crypto`), `ScgiRtorrentControlAdapter.ts` (XML-RPC over SCGI on
  `net.Socket`, `d.stop`+`d.close`), `UserScriptRunnerAdapter.ts` (execFile
  `runuser -u <user> -- <script> <args...>`, detached, errors logged not thrown)
- Create fakes: `kobox/src/infrastructure/system/fakes/FakeRtorrentConfig.ts` (in-memory files),
  `FakeWatchDirs.ts`, `FakeTorrentMetainfo.ts` (preloaded map path→metainfo),
  `FakeRtorrentControl.ts` (records calls), `FakeUserScriptRunner.ts` (records calls)
- Modify: `kobox/src/infrastructure/system/SystemdServiceControlAdapter.ts` (+install/remove/restart
  unit; write unit file only when content differs, then `systemctl daemon-reload` + `enable`),
  `kobox/src/infrastructure/system/fakes/FakeServiceControl.ts` (+installed units map)
- Test: `kobox/test/unit/infrastructure/system/torrent-adapters.test.ts` (runner stub asserting
  argv), `kobox/test/unit/infrastructure/torrent-fakes.test.ts`,
  `kobox/test/unit/infrastructure/system/bencode.test.ts` (encode fixture in-test, assert
  infoHash/name/private/announcers; fast-check: parser never throws unhandled on random bytes —
  returns undefined), extend `kobox/test/integration/system/debian-adapters.test.ts` (real fs:
  apply→changed list, re-apply→empty; unmanaged `99-user.rc` untouched; ScgiRtorrentControl vs an
  in-test `net` SCGI stub server).

**Key behavior — `RtorrentConfigAdapter.apply`:** for each `RenderedFile`: read current content;
identical → skip; else write via temp file + rename, then chown/chmod; returns changed paths.
Never deletes or touches paths it wasn't given.

**Commit:** `feat(torrent): system adapters (config apply, watch dirs, metainfo, scgi control, scripts) with fakes`

## Task 5 — Persistence: schema migration + repositories

**Files:**
- Modify: `kobox/src/infrastructure/persistence/schema.ts` — add `torrentInstances`
  (`id`, `username` unique, `allowPublicTracker` int 0/1 default 0, `syncDisabled` int 0/1
  default 0, `createdAt`), `watchDirs` (`id`, `instanceId` FK cascade, `label`,
  unique(instanceId,label)), `torrents` (`id`, `username`, `infoHash`, `name`, `label`, `state`
  enum loaded/completed/rejected, `tree`, timestamps, unique(username, infoHash))
- Run: `pnpm drizzle-kit generate` (new migration under `kobox/drizzle/`)
- Create: `kobox/src/infrastructure/persistence/SqliteTorrentInstanceRepository.ts`,
  `SqliteTorrentRepository.ts`, `InMemoryTorrentInstanceRepository.ts`, `InMemoryTorrentRepository.ts`
- Test: extend `kobox/test/integration/persistence/sqlite.test.ts` (round-trip instance with
  watch dirs + flags; torrent upsert/state transitions/delete; unique constraints), fakes tested
  via the shared contract in `kobox/test/unit/infrastructure/torrent-fakes.test.ts`

**Commit:** `feat(torrent): drizzle schema and repositories for instances, watch dirs, torrents`

## Task 6 — Job contract extension

**Files:**
- Modify: `kobox/src/application/jobs/contract.ts` — add job types + Zod strict schemas:
  `provision-rtorrent {username}`, `deprovision-rtorrent {username}`,
  `render-rtorrent-config {username}`, `add-watch-dir {username, label}`,
  `set-sync-disabled {username, disabled: boolean}`,
  `set-allow-public-tracker {username, allowed: boolean}`,
  `torrent-event {username, event: 'inserted_new'|'finished'|'erased', infoHash: 40-hex,
  name?, directory?, torrentFile?, torrentDir?, label?}` (paths: absolute, no `..`)
- Test: extend `kobox/test/contract/jobContract.test.ts` (accept/reject cases per schema; the
  closed-enum diff test that catches breaking changes)

**Commit:** `feat(torrent): typed job contract for provisioning, flags and torrent events`

## Task 7 — Use cases (component-tested with fakes)

**Files:**
- Create under `kobox/src/application/torrent/`: `ProvisionRtorrentInstance.ts`,
  `DeprovisionRtorrentInstance.ts`, `RenderRtorrentConfig.ts`, `AddWatchDir.ts`,
  `SetSyncDisabled.ts`, `SetAllowPublicTracker.ts`, `HandleTorrentEvent.ts`, `errors.ts`
- Modify: `kobox/src/interfaces/useCases.ts` (extend `UseCaseDeps` + `UseCases`)
- Test: `kobox/test/component/application/torrent/torrent-lifecycle.test.ts` (+ builders in
  `kobox/test/builders/TorrentInstanceBuilder.ts`)

**Behaviors:**
- `ProvisionRtorrentInstance(username)`: user must exist (`UserNotFoundError`); instance =
  existing or `TorrentInstance.provision` (ports from the user row) saved; `watchDirPort.ensureLayout`;
  render + `configPort.apply`; `services.installUserService`; start only when user active
  (suspended user ⇒ unit installed but stopped). **Idempotent**: second run → zero changed files,
  no restart. Returns `{changedFiles}`.
- `RenderRtorrentConfig(username)`: re-render + apply; restart unit only when
  `changed.length > 0` **and** unit running.
- `AddWatchDir(username, label)`: aggregate `addWatchDir` → save → ensureLayout → re-render
  (delegates to render use case); duplicate label = no-op (no restart).
- `SetSyncDisabled` / `SetAllowPublicTracker`: save flag only — **no file render** (flags are
  read at event time from the DB; that's the whole point of the ADR).
- `HandleTorrentEvent(payload)`:
  - instance must exist (else fail job).
  - `inserted_new`: no `torrentFile` in payload or metainfo unreadable → **native early-exit**
    (return, log; replaces Radarr bypass patch #1). Else `admitTorrent(privacy)`:
    accepted → upsert Torrent `loaded` (label from payload); rejected → upsert `rejected` +
    `control.stopAndClose(scgiPort, hash)` (control failures logged, job still succeeds)
    (replaces patch #2, now per-user first-class).
  - `finished`: upsert → `complete(tree = directory)`; then user-script fan-out via
    `scriptRunner.runFinishedScripts` **unless** `syncDisabled` (flag enforcement, observable).
  - `erased`: delete torrent row (idempotent when absent).

**Component test coverage (fakes):** provision idempotence; suspended-user provision;
watch-dir add renders new schedule + restart-only-when-running; early-exit; public rejected
then allowed after flag flip; finished respects `syncDisabled` both ways; erased idempotent.

**Commit:** `feat(torrent): torrent lifecycle use cases with full component coverage`

## Task 8 — Event spool inbox (unprivileged → root seam)

**Files:**
- Create: `kobox/src/infrastructure/spool/TorrentEventSpool.ts` — writer
  (`submit(event)`: atomic temp+rename JSON into `KOBOX_SPOOL` default
  `/var/spool/kobox/events`, dir expected mode `1733`) and sweeper
  (`collect(): Promise<readonly SpooledEvent[]>` — stat owner uid → username via execFile
  `getent passwd <uid>` (cached), Zod-parse payload, **username always taken from the file
  owner**, malformed files deleted + logged; each collected file deleted after enqueue)
- Modify: `kobox/src/interfaces/worker/main.ts` + `JobWorker.ts` — worker loop: sweep spool →
  `queue.enqueue(parseJob('torrent-event', …))` before draining; `--once` sweeps once
- Modify: `kobox/src/interfaces/composition.ts` (spool wiring, `ensureSpoolDir` for root)
- Test: `kobox/test/component/interfaces/event-spool.test.ts` (tmpdir spool: submit→collect
  round-trip; owner-derived username wins over payload username; malformed JSON quarantined;
  collect on empty dir), worker-loop test extension

**Commit:** `feat(torrent): owner-authenticated event spool between user shims and root worker`

## Task 9 — Worker execution + job chaining + CLI commands

**Files:**
- Modify: `kobox/src/interfaces/worker/JobWorker.ts` — execute the 7 new job types
  (VO reconstruction, authoritative); after successful `create-user` → enqueue
  `provision-rtorrent`; after successful `delete-user` → enqueue `deprovision-rtorrent`
  (Customer/Supplier via chained jobs, no use-case coupling)
- Modify: `kobox/src/interfaces/cli/main.ts` + `buildJob.ts` — commands:
  `provision-rtorrent <user>`, `render-rtorrent-config <user>`, `add-watch-dir <user> <label>`,
  `set-sync-disabled <user> <on|off>`, `set-allow-public-tracker <user> <on|off>` (queue or
  `--direct`), and `torrent-event <type> --hash <h> [--name --directory --torrent-file
  --torrent-dir --label]` → **spool write only** (unprivileged path; never opens the DB)
- Modify: `kobox/src/interfaces/composition.ts` — full wiring (TemplateProvider, adapters, repos)
- Test: extend `kobox/test/component/interfaces/worker-loop.test.ts` (chaining create→provision,
  delete→deprovision; torrent-event job dispatch), CLI covered by E2E

**Commit:** `feat(torrent): worker execution, user-lifecycle chaining and CLI commands`

## Task 10 — E2E Debian 12 (real rtorrent) + docker updates

**Files:**
- Modify: `kobox/docker/Dockerfile` (+`rtorrent` package), `kobox/docker/e2e-setup.sh` (drop the
  dummy `rtorrent-<user>` unit — Phase 1 provisions the real one; keep sshd part)
- Create: `kobox/test/e2e/torrent-lifecycle.e2e.test.ts`
- Modify: `kobox/test/e2e/user-lifecycle.e2e.test.ts` (unit now provisioned by chaining — adjust
  the "simulate Phase 1" step and assertions)
- Modify: `docs/DEV.md` (spool dir, KOBOX_BIN, new make targets unchanged)

**E2E scenario (root, systemd, real rtorrent):** create user via queue → worker chains
provision → assert: `.rtorrent.rc` + shims + `80-watch.rc` rendered with expected content,
unit `rtorrent-<user>` **active** with real rtorrent parsing our config, scgi socket healthy
(`kobox doctor`); write `~/rtorrent/config.d/99-user.rc` + re-run `render-rtorrent-config` →
byte-identical managed files (0 changed), drop-in untouched, no restart; `add-watch-dir films` →
new schedule line + dirs exist; **event path as the user**: `runuser -u <user> ~/.rTorrent_finished.sh
<40-hex> /home/<user>/rtorrent/complete/x ...` → worker `--once` → torrents row `completed`;
`set-sync-disabled on` → same event → user script marker NOT created (and created when off);
`set-allow-public-tracker` respected on an in-test crafted public `.torrent` fixture via
`inserted_new`; delete-user → unit removed, instance+torrents rows gone.

**Commit:** `feat(torrent): full-stack E2E on Debian 12 with a real rtorrent instance`

## Task 11 — Verification, docs, PR draft

- `pnpm lint && pnpm typecheck && pnpm coverage && pnpm build` green locally (pre-push enforces).
- `make up && make test-int && make e2e` green in the Debian 12 container.
- superpowers:requesting-code-review on the diff; fix findings.
- Push branch; **draft PR** → `main`, <200 words, conventional title
  `feat: Phase 1 — Torrent Lifecycle`.

---

**Guardrails reminder:** never touch prod or legacy dirs (`install/ web/ inc/ bin/ scripts/
templates/ upgrade/` read-only — legacy `templates/rtorrent/*` is *read* for reference only);
neutral fixtures (`alice`, `user-a..h`); no real hostnames/IPs; push only when local gates pass.
