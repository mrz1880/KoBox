# DDL & Debrid Download — Implementation Plan

> **For Claude:** Execute task-by-task with TDD (red → green → refactor), one commit per task,
> `verification-before-completion` before each commit. Same discipline as Phases 0-8.

**Goal:** A second download path for KoBox alongside torrents: a user submits a **filehoster
link** (1fichier, …), KoBox resolves it through a **debrid** service (AllDebrid), downloads the
direct link with **aria2**, and lands the file in the user's `~/rtorrent/complete/<category>/`
so the **existing** Radarr/Sonarr NFS folder-import picks it up — identical to the torrent sync
path. Source-agnostic: KoBox never scrapes a source; it debrids-and-downloads a *given* link.

**Architecture:** New bounded context `ddl`. Hexagonal: `DebridPort` (AllDebrid API) +
`DownloaderPort` (aria2 JSON-RPC) + a placement step (root worker moves staged file → user home).
Per-user downloads, one instance-level debrid account. aria2 runs as a dedicated non-root account
behind localhost. The unprivileged portal enqueues a typed job; the root worker resolves +
downloads + places.

**Tech stack:** TS strict (no `any`, readonly ctor, optional chaining), zod at the AllDebrid +
aria2 boundaries, drizzle/better-sqlite3, aria2 (Debian apt), vitest pyramid + Debian E2E.

---

## Locked decisions

1. **Source-agnostic v1**: input is a filehoster link (portal form per-user + CLI/API). No source
   scraping, no indexer, no download-client emulation in KoBox (user's content config, like downarr
   ships no sources).
2. **Debrid account = one instance-level AllDebrid API key** (`KOBOX_ALLDEBRID_APIKEY`, worker.env,
   NEVER in the DB, jobs payload, or logs). Per-user accounts are a documented future enhancement
   (needs a secure per-user secret store).
3. **aria2**: one shared daemon, dedicated non-root `kobox-aria2` account, RPC on `127.0.0.1:6800`
   with a secret token, downloads into a staging dir it owns
   (`/var/lib/kobox/ddl-staging/`). The **root worker** moves the finished file into
   `~user/rtorrent/complete/<category>/` + chowns to the user (aria2 stays non-root; per-user
   placement is the privileged worker's job). Reuses the exact NFS-exported path the torrents use.
4. **Async, job-driven**: portal enqueues `debrid-download`; worker runs `StartDebridDownload`
   (unlock + aria2 addUri + persist); a scheduled `poll-debrid-downloads` advances active
   downloads (aria2 tellStatus → place on complete). Mirrors the fair-use/cert cron pattern.
5. **Secrets**: the AllDebrid key + aria2 RPC secret live only in the worker env; adapters must
   never log a URL containing the key. Job payloads carry an internal `downloadId`, never the key.

---

## Task 1 — Domain VOs

**Files:** Create `src/domain/ddl/FilehosterLink.ts`, `DirectUrl.ts`, `DownloadCategory.ts`,
`DownloadGid.ts`; Test: `test/unit/domain/ddl/*.test.ts`.

- `FilehosterLink.parse(raw)` — a valid `http(s)://` URL (the link the user submits); reject junk.
- `DirectUrl.parse(raw)` — the unrestricted `https` URL from AllDebrid.
- `DownloadCategory.parse(raw)` — enum `films | series` (extensible; maps to the complete subdir).
- `DownloadGid.parse(raw)` — aria2 gid, `/^[0-9a-f]{16}$/` (or aria2's format).

TDD each: valid parse + rejection cases. Commit: `feat(ddl): value objects for debrid downloads`.

## Task 2 — DebridDownload aggregate

**Files:** Create `src/domain/ddl/DebridDownload.ts`; Test: `test/unit/domain/ddl/DebridDownload.test.ts`.

- Props: `id?`, `username: Username`, `category: DownloadCategory`, `sourceLink: FilehosterLink`,
  `status: 'pending'|'downloading'|'done'|'failed'`, `gid?: DownloadGid`, `filename?: string`,
  `error?: string`, `createdAt: string`.
- `static request({username, category, sourceLink}, now)` → pending.
- `restore(props)`, `startedWith(gid)` → downloading, `completed(filename)` → done,
  `failed(error)` → failed. Immutable transitions.

TDD transitions + invariants. Commit: `feat(ddl): DebridDownload aggregate`.

## Task 3 — Persistence (migration 0008 + repo)

**Files:** Modify `src/infrastructure/persistence/schema.ts` (`debrid_downloads`); Create
`drizzle/0008_ddl-debrid.sql` (drizzle-kit generate), `SqliteDebridDownloadRepository.ts`,
`InMemoryDebridDownloadRepository.ts`; port in `src/domain/ddl/ports.ts`; Test:
`test/integration/persistence/ddl-repository.test.ts`.

- Table `debrid_downloads`: id, username, category, source_link, status, gid, filename, error,
  created_at.
- Port `DebridDownloadRepository`: `save`, `findById`, `listActive()` (status downloading),
  `listForUser(username)`.

TDD: integration round-trip (mkdtemp + `KoboxDatabase.open`) + re-entrancy. Commit:
`feat(ddl): debrid_downloads table and repository`.

## Task 4 — DebridPort + AllDebridAdapter

**Files:** `src/domain/ddl/ports.ts` (`DebridPort`), `src/application/ddl/debridSchemas.ts` (zod),
`src/infrastructure/system/AllDebridAdapter.ts`; Test: unit (zod parse), integration
(`test/integration/system/alldebrid.test.ts` against a stub HTTP server).

- `DebridPort.unlock(link: FilehosterLink): Promise<{ direct: DirectUrl; filename?: string }>`.
- Adapter: HTTPS GET `https://api.alldebrid.com/v4/link/unlock?agent=kobox&apikey=<key>&link=<link>`;
  zod-parse `{status:'success',data:{link,filename,...}}` and the error shape; throw a typed
  `DebridError` on `status:'error'` (invalid key / unsupported host / …). **Never log the key.**
  (Verify the exact response schema against the AllDebrid v4 API docs during implementation.)

TDD: parse success/error fixtures; adapter against a local stub returning canned JSON. Commit:
`feat(ddl): AllDebrid unlock adapter`.

## Task 5 — DownloaderPort + Aria2Adapter

**Files:** `src/domain/ddl/ports.ts` (`DownloaderPort`), `src/application/ddl/aria2Schemas.ts`,
`src/infrastructure/system/Aria2Adapter.ts`; Test: unit (zod), integration (fake JSON-RPC server).

- `DownloaderPort.addUri(url: DirectUrl, dir: string): Promise<DownloadGid>`;
  `status(gid): Promise<{ state: 'active'|'complete'|'error'; filePath?: string; message?: string }>`.
- Adapter: JSON-RPC POST to `KOBOX_ARIA2_RPC_URL` with `token:<secret>` → `aria2.addUri`,
  `aria2.tellStatus`; zod-parse. **Never log the secret.**

TDD: parse fixtures; adapter against a local stub RPC. Commit: `feat(ddl): aria2 JSON-RPC downloader adapter`.

## Task 6 — Placement port + adapter (staged → user home)

**Files:** `src/domain/ddl/ports.ts` (`DownloadPlacementPort`),
`src/infrastructure/system/DdlPlacementAdapter.ts`; Test: integration
(`test/integration/system/ddl-placement.int.test.ts`, Debian-gated for chown).

- `DownloadPlacementPort.place(stagedPath, username, category): Promise<string>` — mkdir
  `~user/rtorrent/complete/<category>/`, move the file in, chown to the user's uid:gid (reuse the
  identity port for uid/gid), return the final path. Root-only (worker).

TDD: integration moving a temp file + asserting ownership (skipIf non-root). Commit:
`feat(ddl): place a finished download into the user home`.

## Task 7 — Use cases (Request / Start / Poll)

**Files:** `src/application/ddl/RequestDebridDownload.ts`, `StartDebridDownload.ts`,
`PollDebridDownloads.ts`; Test: `test/component/application/ddl/*.test.ts`.

- `RequestDebridDownload` (unprivileged): validate VOs → persist a `pending` row → enqueue
  `debrid-download { downloadId }`. Returns the row id.
- `StartDebridDownload` (worker): load row → `debrid.unlock` → `downloader.addUri(url, staging)` →
  `row.startedWith(gid)`; on unlock/add failure → `row.failed(msg)`.
- `PollDebridDownloads` (worker/scheduler): for each active row → `downloader.status(gid)` →
  complete: `placement.place` → `row.completed(filename)`; error → `row.failed(msg)`.

TDD (fakes + in-memory repo): request persists+enqueues; start unlocks+adds+records; poll places
on complete and fails on error; idempotent re-poll. Commit: `feat(ddl): request/start/poll use cases`.

## Task 8 — Job contract, worker wiring, scheduler

**Files:** `src/application/jobs/contract.ts` (+ `debrid-download`, `poll-debrid-downloads`),
`src/interfaces/cli/buildJob.ts`, `src/interfaces/worker/JobWorker.ts`,
`src/interfaces/useCases.ts` (a `ddlUseCases` group), `src/interfaces/composition.ts` (adapters +
env), the scheduler cron (`poll-debrid-downloads` every few min, `enqueueUnique`). Test: contract
snapshot, worker-loop component.

- Env: `KOBOX_ALLDEBRID_APIKEY`, `KOBOX_ARIA2_RPC_URL`, `KOBOX_ARIA2_RPC_SECRET`, staging dir. Wire
  `AllDebridAdapter` + `Aria2Adapter` + `DdlPlacementAdapter` + repo into the worker use cases.
- Skip cleanly when the debrid key is unset (feature off = honest no-op, like unpinned components).

TDD: `parseJob` accepts the new types (contract snapshot regen); worker dispatches them. Commit:
`feat(ddl): job types, worker handlers and poll scheduler`.

## Task 9 — aria2 install component

**Files:** `src/domain/installation/ComponentName.ts` (`aria2`), `catalog.ts`
(`spec('aria2', ['kobox-core'])`), `rendering.ts` (`renderAria2Unit`), `installers.ts`
(`Aria2Installer`: apt `aria2`, ensureServiceAccount `kobox-aria2`, staging dir, render+enable
unit), register in `buildInstallers`; Test: installer component + rendering golden + E2E gate list.

- `renderAria2Unit`: `User=kobox-aria2`, hardened, `ExecStart=/usr/bin/aria2c --enable-rpc
  --rpc-listen-port=6800 --rpc-listen-all=false --rpc-secret=<token> --dir=<staging> --continue`.
  The RPC secret comes from the worker env at render time (or a rendered aria2.env).

TDD: installer test (apt + account + unit + enable), golden, add `aria2` to the E2E skip list if
unpinned/keyless. Commit: `feat(installation): aria2 component for debrid downloads`.

## Task 10 — Portal Downloads page

**Files:** `src/interfaces/http/views/userPages.ts` (`downloadsPage`), `routes/user.ts`
(`GET /downloads` list + form; `POST /downloads` → RequestDebridDownload, CSRF, per-user),
`layout.ts` (USER_NAV `['/downloads','Downloads']`); Test: portal component (submit enqueues;
list is per-user; a user can't see another's).

TDD: POST enqueues a `debrid-download` and shows in the list; scoped to `session.username`. Commit:
`feat(portal): per-user Downloads page (submit a link, track status)`.

## Task 11 — E2E + docs

**Files:** `test/e2e/ddl-debrid.e2e.test.ts`; `docs/OPS.md` (KOBOX_ALLDEBRID_APIKEY setup + the
DDL flow). E2E: **stub the debrid** (a local resolver returning a URL to a local HTTP file server —
real AllDebrid can't run in CI) → submit a link via CLI/portal → aria2 downloads → worker places
into `~user/rtorrent/complete/films` → assert the file is there, user-owned. Proves the whole
plumbing minus the real debrid call (which the integration test covers against a stub).

Commit: `test(ddl): container E2E link → debrid(stub) → aria2 → user home`.

---

## End of phase

- `requesting-code-review`; draft PR (<200 words, no session link, no personal identifiers).
- Update memory; note per-user debrid accounts + source auto-discovery (downarr-style) as the
  documented v1.x follow-ups.
