# Phase 2 — Tracker & Blocklist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute in-session) with
> superpowers:test-driven-development for every task. One commit per task.

**Goal:** Implement the Tracker & Blocklist bounded context (the MySB signature feature): per-tracker
SSL certificate auto-fetch/renewal (closing the §5.1 root injection via a shell-safe `TrackerHost` +
argv-only openssl adapter), tracker discovery from torrent announcers, declarative idempotent
whitelist rendering (BIND zones, dnscrypt `blocked-names.txt`, PeerGuardian `allow.p2p`), and
verified blocklist downloads rendered into per-user `ipv4_filter` files (closing §5.6
`curl --insecure` and issue #117 subscription resilience).

**Architecture:** New hexagonal context `kobox/src/domain/tracker/` (VOs + `Tracker` aggregate +
`Blocklist` entity + pure rendering) / `application/tracker/` (use cases) / infrastructure adapters
(openssl cert fetch, cert store, DNS lookup, verified HTTPS download, managed-file apply).
Torrent → Tracker stays event-ish (AUDIT §2 context map): `HandleTorrentEvent` publishes seen
announcers through an `AnnouncerSink` port; the composition wires it to enqueue typed
`discover-tracker` jobs consumed by the Tracker context. Rendering reuses the Phase 1
`RenderedFile`/apply (write-if-changed) pattern, extracted to `domain/shared`.

**Tech Stack:** TypeScript strict, Drizzle/SQLite (WAL), Zod, vitest + fast-check, golden files,
Debian 12 systemd container (real openssl / bind9utils / rtorrent) for integration/E2E. No new
runtime dependencies (bespoke minimal iblocklist XML parse, `node:zlib` gunzip, `node:crypto` sha256).

**Locked decisions honored:** no `any`, `readonly`, optional chaining, execFile argv-only,
VOs at every domain boundary, worker-root privilege model, idempotent declarative rendering
golden-tested (never `>` over an edited file), verified downloads only (TLS + gzip integrity +
sha256 recorded), public repo → neutral fixtures (`tracker.example.org`, `alice`, `user-a..h`),
tests never reach the real network (local fixture servers only).

**Out of scope (deferred to Phase 3+):** firewall/fail2ban/DynDNS/VPN, per-user metering,
`pglcmd`/bind/dnscrypt *service* management (we render files and call a best-effort
`NetworkServiceReloadPort` — interface posed now, Security implements it for real), portal pages.

**Branch:** `feature/phase2-tracker-blocklist` from `main`.

---

## Task 1 — Domain VOs (`TrackerHost`, `TrackerProto`, `TrackerPrivacy`, `CheckState`, `CertExpiry`, `IpAddress`, `BlocklistUrl`, `BlocklistSource`)

**Files:**
- Create: `kobox/src/domain/tracker/TrackerHost.ts`, `TrackerProto.ts`, `TrackerPrivacy.ts`,
  `CheckState.ts`, `CertExpiry.ts`, `BlocklistUrl.ts`, `BlocklistSource.ts`
- Create: `kobox/src/domain/shared/IpAddress.ts` (transverse — allow.p2p, tracker IPs)
- Test: `kobox/test/unit/domain/tracker/*.test.ts` + `kobox/test/unit/domain/shared/IpAddress.test.ts`

**Specs:**
- `TrackerHost.parse(raw)` — **the §5.1 fix.** Validated FQDN, shell-safe by construction:
  lowercase-normalized, total ≤253 chars, ≥2 labels, each label `/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/`,
  rejects leading `-` (no option injection), `_`, spaces, any metacharacter, IP-only forms are
  allowed (a host that is an IPv4 literal is valid — legacy has such trackers). Accessors:
  `value`, `registrableDomain` (last two labels; the IPv4-literal case returns `value`), `equals`.
  **fast-check properties:** (1) any parsed value matches `/^[a-z0-9.-]+$/` and never starts with
  `-`; (2) strings containing characters outside `[A-Za-z0-9.-]` always throw
  (`InvalidTrackerHostError` extends `DomainError`); (3) parse is idempotent (parse(parse(x).value)
  round-trips).
- `TrackerProto`: closed enum VO `http | https | udp` with `parse`, `defaultPort` (80/443/80 —
  legacy semantics), `isCheckable` (http/https true, udp false).
- `TrackerPrivacy`: closed enum `public | private` with `parse`.
- `CheckState`: closed enum `none | pending | checking` with `parse` + `fromLegacy(0|1|3)`
  mapping documented (0→none, 1→pending, 3→checking).
- `CertExpiry.on(isoDate)`: ISO `YYYY-MM-DD` value; `isDueOn(today: string, marginDays = 2)` —
  due when `today >= expiry - margin` (models the legacy "2 days ago" skew explicitly instead of
  storing a skewed date). Invalid date throws.
- `IpAddress.parse(raw)`: strict IPv4 dotted-quad (each octet 0-255, no leading `+`/spaces);
  rejects `127.0.0.1` and `0.0.0.0` via `isUsable` accessor (legacy skips them), `equals`.
- `BlocklistUrl.parse(raw)`: **https only** (§5.6 fix — `http://list.iblocklist.com` is rewritten
  to `https://` at catalogue import, not here), valid URL, host shell-safe charset; `value`,
  `withCredentials(username, pin)` returns a new URL string with `&username=…&pin=…` appended
  (never logged — no `toString` leaking credentials: `withCredentials` output is handed straight
  to the download port).
- `BlocklistSource`: closed enum `iblocklist | personal` with `parse`.

**TDD steps:** per VO: failing unit test (BDD-ish names, fast-check for `TrackerHost` and
`IpAddress`) → `pnpm test:unit` fail → implement (`private constructor` + `static parse`, style
matched on `Username`/`Announcer`) → pass.

**Commit:** `feat(tracker): domain value objects with shell-safe TrackerHost`

## Task 2 — `Tracker` aggregate, `Blocklist` entity, domain events, ports (+ `RenderedFile` extraction)

**Files:**
- Create: `kobox/src/domain/tracker/Tracker.ts`, `Blocklist.ts`, `events.ts`, `ports.ts`
- Create: `kobox/src/domain/shared/files.ts` (extracted `RenderedFile` + `ManagedFilesPort`)
- Modify: `kobox/src/domain/torrent/ports.ts` (re-export `RenderedFile` from shared;
  `RtorrentConfigPort extends ManagedFilesPort`)
- Test: `kobox/test/unit/domain/tracker/Tracker.test.ts`, `Blocklist.test.ts`

**Specs:**
- `domain/shared/files.ts`: move the `RenderedFile` interface verbatim from torrent ports;
  `ManagedFilesPort { apply(files: readonly RenderedFile[]): Promise<readonly string[]> }`.
  Torrent context keeps compiling via re-export (no behavior change; all existing tests stay green).
- `Tracker` (aggregate root, keyed by host): props `host: TrackerHost`, `proto: TrackerProto`,
  `port: number (1-65535)`, `privacy: TrackerPrivacy`, `isActive: boolean`, `isDead: boolean`,
  `isSsl: boolean`, `checkState: CheckState`, `certExpiry?: CertExpiry`, `lastCheck?: string`,
  `ipv4: readonly IpAddress[]`, optional `id`. Immutable style (`discover()` static + `restore()`
  + `props()`), like `SeedboxUser`/`TorrentInstance`.
  - `Tracker.discover({host, proto, port, privacy})` → `{tracker, event: TrackerDiscovered}`;
    `checkState` = `pending` when `proto.isCheckable`, else `none`; active, not dead, not ssl.
  - `updateAddresses(ips)` → new instance; when the set changed, `checkState` returns to
    `pending` (legacy `bForceUpdate`); unusable IPs (`127.0.0.1`/`0.0.0.0`) filtered here.
  - `beginCheck()` → `checking` (the legacy `to_check=3` lock); `completeCheck({promoted, expiry?})`:
    promoted → `isSsl=true, proto=https, checkState=none, certExpiry=expiry`; not promoted →
    `isSsl=false, checkState=none, certExpiry=undefined`. Both stamp `lastCheck`.
  - `markDead()` → `{tracker (isDead=true, isActive=false), event: TrackerDied}`; idempotent
    (already dead → no event).
  - `needsCertCheck(today)`: `checkState === pending` OR (`isSsl` AND `certExpiry?.isDueOn(today)`).
- `Blocklist` (entity): `source: BlocklistSource`, `author: string`, `name: string` (non-empty),
  `url: BlocklistUrl`, `subscription: boolean`, `enabled: boolean`, `lastUpdate?: string`
  (ISO or `'failed'` — model as tagged union `{ status: 'ok'; at: string } | { status: 'failed' }`
  instead of the legacy magic string), `sha256?: string`. `recordSuccess(at, sha256)` /
  `recordFailure()` / `enable()` / `disable()` returning new instances. `fileStem` accessor:
  `<author>#<name>` with spaces → `_` (legacy file naming, used in tests only — rendered output
  is a single merged file).
- `events.ts`: `TrackerDiscovered {type, host}`, `TrackerDied {type, host}`,
  `TrackerCertRenewed {type, host, expiresOn}`, `BlocklistUpdateFailed {type, author, name}` —
  union `TrackerEvent`.
- `ports.ts`:
  ```ts
  TrackerRepository { findByHost(host): Promise<Tracker | undefined>; listAll(): Promise<readonly Tracker[]>;
                      listNeedingCertCheck(today: string): Promise<readonly Tracker[]>; save(t): Promise<Tracker>; }
  BlocklistRepository { listAll(): Promise<readonly Blocklist[]>; listEnabled(): Promise<readonly Blocklist[]>;
                        findBySourceAuthorName(...): Promise<Blocklist | undefined>; save(b): Promise<Blocklist>; }
  UserAddressRepository { listAll(): Promise<readonly UserAddress[]>; add(username, ip): Promise<void>;
                          remove(username, ip): Promise<void>; }   // UserAddress = { username: Username; ip: IpAddress }
  TrackerCertPort { fetch(host: TrackerHost, port: number): Promise<FetchedCert | undefined> }
      // FetchedCert = { readonly pem: string; readonly expiresOn: string /* ISO date */ }
      // undefined = no TLS answer (timeout, refused, no cert) — NOT an exception path
  CertStorePort { install(host: TrackerHost, pem: string): Promise<void>;
                  remove(host: TrackerHost): Promise<void>; rehash(): Promise<void>; }
  DnsResolverPort { resolveA(host: TrackerHost): Promise<readonly IpAddress[]> } // [] = NXDOMAIN/no answer
  BlocklistDownloadPort { fetch(url: string): Promise<DownloadedList | undefined> }
      // DownloadedList = { readonly ranges: readonly string[]; readonly sha256: string }
      // adapter gunzips + parses p2p format; undefined = download or integrity failure
  IblocklistCatalogPort { fetchCatalog(): Promise<readonly CatalogEntry[]> }
      // CatalogEntry = { name; author; listId; url; subscription: boolean }
  TrackerNotificationPort { notify(event: TrackerEvent): Promise<void> }
  NetworkServiceReloadPort { reloadDns(): Promise<void>; reloadPeerGuardian(): Promise<void> }
      // Security-phase partnership seam (AUDIT §2): Phase 2 adapters are best-effort no-fail
  ```

**Commit:** `feat(tracker): Tracker aggregate, Blocklist entity, context ports and events`

## Task 3 — Declarative whitelist & blocklist rendering + golden files

**Files:**
- Create: `kobox/src/domain/tracker/rendering.ts` (pure)
- Test: `kobox/test/unit/domain/tracker/rendering.test.ts` + goldens under
  `kobox/test/golden/tracker/`: `zones.blacklists.golden`, `blocked-names.txt.golden`,
  `allow.p2p.golden`, `80-blocklist.rc.golden`, `blocklist_rtorrent.txt.golden`

**Specs (formats mirror the legacy exactly — anchors: `funcs_MySB_SecurityRules:278-304`,
`funcs_PeerGuardian:469-516`, `scripts/BlocklistsRTorrent.bsh`, `funcs_MySB_CreateUser:850-851`):**
- `renderBlacklistZones(trackers): RenderedFile` → `/etc/bind/kobox.zones.blacklists`
  (0644 root:root — KoBox-owned name; the E2E includes it from `named.conf.local` itself):
  header `#### KoBox - Blacklisted domains (ex: inactive trackers)` then, for every tracker with
  `isActive === false`, `zone "<host>" { type master; file "/etc/bind/db.empty"; };` sorted by host.
- `renderBlockedNames(trackers): RenderedFile` → `/etc/dnscrypt-proxy/blocked-names.txt` (0644):
  KoBox header comment + one `<host>` line per inactive tracker, sorted.
- `renderAllowP2p(users, trackers): RenderedFile` → `/etc/pgl/allow.p2p` (0644): the legacy
  static header block, then `## Allow all KoBox users` + `<username>:<ip>-255.255.255.255` per
  user address, then `## Trackers enabled` + `<host>:<ip>-255.255.255.255` per usable IP of every
  **active, non-banned** tracker. Sections omitted when empty. Deterministic ordering
  (username, then host, then IP).
- `renderUserBlocklistDropin(username, enabled): RenderedFile` →
  `/home/<user>/rtorrent/config.d/80-blocklist.rc` (0640 root:<user>): when enabled,
  `ipv4_filter.load = /home/<user>/blocklist/blocklist_rtorrent.txt, unwanted` + daily reload
  `schedule2 = load_filter,0,24:00:00,...` + the `print` size line (legacy shape); when no
  blocklist data exists, a comment-only file (still rendered — declarative, never deleted).
- `mergeBlocklistRanges(lists: readonly (readonly string[])[]): readonly string[]` — pure
  assembly of the merged rtorrent filter: concatenates, drops lines with spaces / not starting
  with a digit / without a dot, dedupes, numeric sort (the legacy `del_spaces`/`not_numeric`/
  `dot`/`sort_uniq` pipeline as one pure function). `renderUserBlocklistFile(username, ranges):
  RenderedFile` → `/home/<user>/blocklist/blocklist_rtorrent.txt` (0640 root:<user>).
- **Idempotence property test:** rendering twice with the same inputs is byte-identical;
  golden tests on a neutral fixture set (users `alice` 198.51.100.7 / `bob` 198.51.100.8+.9;
  trackers `tracker.example.org` active https with IPs 192.0.2.10/.11, `dead.example.net`
  inactive, `udp.example.io` active udp no cert; ranges fixture with dirty lines to filter).
  `UPDATE_GOLDEN=1` rewrites (same convention as Phase 1).

**Commit:** `feat(tracker): declarative golden-tested whitelist and blocklist rendering`

## Task 4 — Persistence: schema migration + repositories

**Files:**
- Modify: `kobox/src/infrastructure/persistence/schema.ts` — add:
  - `trackers` (`id`, `host` unique, `domain`, `proto` enum http/https/udp, `port` int,
    `privacy` enum public/private, `isActive` int 0/1, `isDead` int 0/1, `isSsl` int 0/1,
    `checkState` enum none/pending/checking, `certExpiration` text nullable, `lastCheck` text
    nullable, `createdAt`)
  - `trackerIpv4` (`id`, `trackerId` FK cascade, `ipv4`, unique(trackerId, ipv4))
  - `blocklists` (`id`, `source` enum iblocklist/personal, `author`, `name`, `url`,
    `subscription` int 0/1, `enabled` int 0/1, `lastUpdateStatus` enum ok/failed nullable,
    `lastUpdateAt` text nullable, `sha256` text nullable, unique(source, author, name))
  - `userAddresses` (`id`, `username`, `ipv4`, unique(username, ipv4))
- Run: `pnpm drizzle-kit generate`
- Create: `kobox/src/infrastructure/persistence/SqliteTrackerRepository.ts`,
  `SqliteBlocklistRepository.ts`, `SqliteUserAddressRepository.ts` + `InMemory*` fakes
- Test: extend `kobox/test/integration/persistence/sqlite.test.ts` (tracker round-trip with IPs +
  state transitions persisted; `listNeedingCertCheck` picks pending + due-expiry only; blocklist
  upsert + tagged lastUpdate mapping; unique constraints), fakes covered by a shared contract
  test in `kobox/test/unit/infrastructure/tracker-fakes.test.ts`

**Commit:** `feat(tracker): drizzle schema and repositories for trackers, blocklists, user addresses`

## Task 5 — Infrastructure adapters + fakes

**Files:**
- Create: `kobox/src/infrastructure/system/OpensslTrackerCertAdapter.ts` — **the §5.1 closure.**
  `fetch(host, port)`: execFile argv-only `openssl s_client -connect <host>:<port>` (host/port from
  VOs — no shell string can exist), 10 s timeout, stdin closed; extracts the
  `BEGIN CERTIFICATE…END CERTIFICATE` block from stdout; empty → undefined. Expiry via a second
  argv-only call `openssl x509 -enddate -noout` with the PEM on **stdin**; parses `notAfter=` to
  ISO. Never throws on unreachable hosts (returns undefined); throws only on openssl being absent.
- Create: `CertStoreAdapter.ts` — `install`: write PEM to `/etc/ssl/certs/<host>.pem` via the
  shared write-if-changed helper (0644 root:root, temp+rename); `remove`: unlink if present;
  `rehash`: execFile `openssl rehash /etc/ssl/certs` (modern equivalent of `c_rehash`), errors
  logged not thrown.
- Create: `DnsLookupResolverAdapter.ts` — `node:dns/promises` `lookup(host, {all: true, family: 4})`
  (getaddrinfo: honors `/etc/hosts` — required by the E2E); NXDOMAIN/ENOTFOUND → `[]`;
  maps to `IpAddress`, drops unusable.
- Create: `HttpsBlocklistDownloadAdapter.ts` — **the §5.6 closure.** `node:https` GET (https only
  by construction of `BlocklistUrl`; optional `ca` injection for tests), size cap (32 MiB),
  gunzip via `node:zlib` (integrity: a truncated/corrupt gz → undefined), parse p2p format
  (`description:start-end` → range lines), sha256 of the raw body recorded. Any failure →
  undefined (caller isolates per-list — issue #117). Redirect follow: single hop, https-only.
- Create: `IblocklistCatalogAdapter.ts` — fetches `https://www.iblocklist.com/lists.xml` via the
  same https helper (test seam: URL injectable); minimal bespoke XML scan for
  `<list><id>…</id><name>…</name><author>…</author><subscription>…</subscription></list>` records
  (line-tolerant, no new dependency); builds
  `https://list.iblocklist.com/?list=<id>&fileformat=p2p&archiveformat=gz` URLs.
- Create: `NetworkServiceReloadAdapter.ts` — best-effort execFile `rndc reload` /
  `systemctl restart dnscrypt-proxy` / `pglcmd reload`; every failure logged, never thrown
  (the services belong to Phase 3; files are the truth).
- Extend: `ConsoleNotificationAdapter` implements `TrackerNotificationPort` too (same console
  JSON line); `FakeNotifications` records both unions.
- Create fakes: `fakes/FakeTrackerCert.ts` (map host→FetchedCert), `FakeCertStore.ts` (in-memory
  installed map + rehash counter), `FakeDnsResolver.ts` (map host→IPs, default []),
  `FakeBlocklistDownload.ts` (map url→DownloadedList), `FakeIblocklistCatalog.ts`,
  `FakeNetworkServiceReload.ts` (call recorder)
- Test: `kobox/test/unit/infrastructure/system/tracker-adapters.test.ts` (runner stub asserting
  exact argv — proving no shell involvement; PEM block extraction; notAfter parsing; p2p parse +
  gunzip failure → undefined; catalog XML fixture parse; https-only redirect rules),
  `kobox/test/unit/infrastructure/tracker-fakes.test.ts`

**Commit:** `feat(tracker): system adapters (openssl argv-only, cert store, dns, verified downloads) with fakes`

## Task 6 — Job contract extension

**Files:**
- Modify: `kobox/src/application/jobs/contract.ts` — add types + Zod strict schemas
  (`trackerHostField` = FQDN regex mirroring `TrackerHost`, wire-level; VOs stay authoritative):
  - `discover-tracker { url: string (http/https/udp URL, ≤2048), privacy: 'public'|'private' }`
  - `fetch-tracker-cert { host: trackerHostField }`
  - `renew-tracker-certs { today: 'YYYY-MM-DD' }`
  - `mark-tracker-dead { host: trackerHostField }`
  - `update-blocklists {}` (strict empty object)
  - `import-blocklist-catalog {}` (strict empty object)
  - `render-whitelist {}` (strict empty object)
  - `render-blocklist-filters { username?: usernameField }` (absent = all users)
  - `add-user-address { username: usernameField, ipv4: dotted-quad regex }`, `remove-user-address` idem
- Test: extend `kobox/test/contract/jobContract.test.ts` (accept/reject cases per schema +
  snapshot diff)

**Commit:** `feat(tracker): typed job contract for discovery, certs, whitelist and blocklists`

## Task 7 — Use cases (component-tested with fakes)

**Files:**
- Create under `kobox/src/application/tracker/`: `DiscoverTrackerFromTorrent.ts`,
  `FetchTrackerCert.ts`, `RenewTrackerCerts.ts`, `MarkTrackerDead.ts`, `ImportBlocklistCatalog.ts`,
  `UpdateBlocklists.ts`, `RenderWhitelist.ts`, `RenderBlocklistFilters.ts`, `ManageUserAddress.ts`,
  `errors.ts`
- Modify: `kobox/src/interfaces/useCases.ts` (`TrackerUseCaseDeps` + `TrackerUseCases` +
  `buildTrackerUseCases`)
- Test: `kobox/test/component/application/tracker/tracker-lifecycle.test.ts`,
  `blocklist-update.test.ts` (+ builder `kobox/test/builders/TrackerBuilder.ts`)

**Behaviors:**
- `DiscoverTrackerFromTorrent({url, privacy})`: parse via `Announcer` → `TrackerHost`; port =
  explicit URL port or `proto.defaultPort`. Resolve A records: **zero records + tracker known** →
  `markDead()` path (event → notification); zero records + unknown → do nothing (never insert a
  dead-on-arrival host). Known host → `updateAddresses` (+ port refresh). New host →
  `Tracker.discover` + addresses. Returns `{tracker, certCheckWanted: boolean}`
  (`needsCertCheck(today)`) so the worker can chain `fetch-tracker-cert` — the use case never
  touches the queue itself.
- `FetchTrackerCert({host, today})`: tracker must exist; `beginCheck()` saved (visible lock,
  legacy `to_check=3`); `certPort.fetch(host, port)`:
  - cert → `certStore.install` + `rehash`; `completeCheck({promoted: true, expiry})`;
    if expiry changed vs previous → `TrackerCertRenewed` notification. Then re-render whitelist
    (returns `{whitelistDirty: true}` for chaining).
  - no cert → `completeCheck({promoted: false})` (http tracker stays http; no error).
  - port errors (openssl missing) → job fails, `checkState` restored to `pending` in a
    `finally`-style guard (no tracker stuck in `checking`).
- `RenewTrackerCerts({today})`: `repo.listNeedingCertCheck(today)` → sequential
  `FetchTrackerCert` per tracker (isolated failures — one bad tracker never blocks the rest);
  returns summary `{checked, promoted, failed}`.
- `MarkTrackerDead({host})`: aggregate `markDead()`; on event → notification + certStore.remove;
  returns `{whitelistDirty}`.
- `ImportBlocklistCatalog()`: catalogue entries upserted as `Blocklist` (source iblocklist);
  URLs rewritten https; the legacy curated enable-set (`cruzit, malc0de, zeus, badpeers, level1,
  level2, microsoft, rangetest, pedophiles` + listed countries) enabled by default **only on
  first insert** (existing rows keep their operator-set `enabled` — idempotent re-import);
  subscription lists never auto-enabled. `P2P allow` skipped (legacy rule).
- `UpdateBlocklists()`: for each enabled list: credentials appended for subscription lists when
  configured (from `iblocklistIdent` — store as a 1-row table or reuse? **decision: table
  `blocklistCredentials` deferred; Phase 2 reads env `KOBOX_IBLOCKLIST_USER/PIN` via a
  `CredentialsProvider` injected value** — secrets never in DB/logs); `download.fetch`:
  success → `recordSuccess(at, sha256)`, failure → `recordFailure()` + `BlocklistUpdateFailed`
  notification, **other lists continue and previous good data is kept** (issue #117). Merged
  ranges = `mergeBlocklistRanges(successful downloads)`; when at least one list succeeded →
  returns `{ranges, updated, failed}`; when all failed → keep previous rendered files untouched
  (`ranges: undefined`).
- `RenderWhitelist()`: load users' addresses + all trackers → apply
  `[zones, blockedNames, allowP2p]` via `ManagedFilesPort` → when changed:
  `reload.reloadDns()` + `reloadPeerGuardian()` (best-effort). Returns changed paths.
- `RenderBlocklistFilters({username?, ranges})`: for each target user (must have a torrent
  instance): apply blocklist file + `80-blocklist.rc` drop-in; restart of rtorrent NOT required
  (daily `schedule2` reload picks it up) — no service calls. Empty ranges → comment-only drop-in.
- `ManageUserAddress(add|remove)`: repo mutation, returns `{whitelistDirty: true}`.

**Component coverage (fakes):** discovery insert/update/dead paths incl. IP-change re-check;
cert fetch promotion + renewal notification + stuck-`checking` guard; renewal isolation;
catalogue idempotence (operator toggles survive re-import); #117 resilience (one subscription
failure → others updated, old data kept, notification sent); whitelist render idempotence
(second run → 0 changed, no reload); per-user filter rendering.

**Commit:** `feat(tracker): tracker and blocklist use cases with full component coverage`

## Task 8 — Torrent → Tracker seam (announcer publication)

**Files:**
- Modify: `kobox/src/domain/torrent/ports.ts` — add
  `AnnouncerSink { published(announcers: readonly Announcer[], privacy: 'public'|'private'): Promise<void> }`
- Modify: `kobox/src/application/torrent/HandleTorrentEvent.ts` — in `onInsertedNew`, after a
  successful metainfo read (accepted **or** rejected — the legacy discovers trackers on every
  insert), call `deps.announcers.published(metainfo.announcers, privacy)`; failures logged,
  never fail the event job.
- Create: `kobox/src/infrastructure/jobs/EnqueueAnnouncerSink.ts` — implements the sink by
  enqueueing one `discover-tracker` job per unique announcer host (dedupe within the call).
- Create fake: `fakes/FakeAnnouncerSink.ts` (records calls).
- Test: extend `kobox/test/component/application/torrent/torrent-lifecycle.test.ts`
  (inserted_new publishes announcers once, including for rejected public torrents; sink failure
  does not fail the job).

**Commit:** `feat(tracker): torrent context publishes announcers to the tracker context`

## Task 9 — Worker execution + chaining + CLI commands

**Files:**
- Modify: `kobox/src/interfaces/worker/JobWorker.ts` — execute the new job types (VO
  reconstruction authoritative); chaining in `chainAfter`: `discover-tracker` result wanted a
  cert → enqueue `fetch-tracker-cert`; `fetch-tracker-cert` / `mark-tracker-dead` /
  `add/remove-user-address` dirty → enqueue `render-whitelist`; `update-blocklists` with ranges →
  enqueue `render-blocklist-filters` (all users). (Use-case return values surfaced to the worker
  via the existing execute path — keep jobs decoupled from each other.)
- Modify: `kobox/src/interfaces/cli/main.ts` + `buildJob.ts` — commands: `discover-tracker <url>
  [--privacy public|private]`, `fetch-tracker-cert <host>`, `renew-tracker-certs` (today = local
  date at the CLI boundary), `mark-tracker-dead <host>`, `import-blocklist-catalog`,
  `update-blocklists`, `render-whitelist`, `render-blocklist-filters [user]`,
  `add-user-address <user> <ipv4>`, `remove-user-address <user> <ipv4>`, `list-trackers`
  (read-only table incl. cert expiry — the operator view).
- Modify: `kobox/src/interfaces/composition.ts` — full wiring (tracker repos, adapters,
  `EnqueueAnnouncerSink` into torrent deps, notification adapter).
- Test: extend `kobox/test/component/interfaces/worker-loop.test.ts` (discover→fetch-cert→
  render-whitelist chain; update-blocklists→render-filters chain; failed fetch does not chain).

**Commit:** `feat(tracker): worker execution, tracker chaining and CLI commands`

## Task 10 — Integration tests (real openssl / bind9utils / sqlite in the container)

**Files:**
- Modify: `kobox/docker/Dockerfile` — add `bind9utils` (named-checkconf/named-checkzone),
  `dnscrypt-proxy` NOT installed (files only); openssl already present.
- Extend: `kobox/test/integration/system/debian-adapters.test.ts` (or new
  `tracker-adapters.int.test.ts`):
  - `OpensslTrackerCertAdapter` against an in-test TLS server: generate a self-signed cert
    (execFile `openssl req -x509 …` into a tmpdir) + `openssl s_server` (or `node:tls` server
    using the generated keypair — prefer `node:tls`, no process management) on `127.0.0.1:<port>`;
    fetch → PEM matches, expiry parsed; closed port → undefined.
  - `CertStoreAdapter` install/rehash on a tmpdir CApath: symmetric hash links exist after rehash.
  - Rendered BIND zone file validated with `named-checkconf` on a minimal `named.conf` including
    it (proves the zone syntax on a real bind toolchain).
  - `HttpsBlocklistDownloadAdapter` against an in-test `node:https` server (self-signed CA
    injected): valid gz → ranges + sha256; corrupted gz → undefined; http URL → constructor
    rejection at the VO layer.

**Commit:** `test(tracker): integration coverage against real openssl and bind toolchains`

## Task 11 — E2E Debian 12 (full chain) + docs

**Files:**
- Modify: `kobox/docker/e2e-setup.sh` — `/etc/hosts` entry `127.0.0.1 tracker.example.org`
  (DNS seam for `dns.lookup`); ensure `/etc/pgl` + `/etc/dnscrypt-proxy` + `/etc/bind` dirs exist.
- Create: `kobox/test/e2e/tracker-blocklist.e2e.test.ts`
- Modify: `docs/DEV.md` (new make targets unchanged; tracker fixture endpoints documented)

**E2E scenario (root, systemd, real rtorrent + real openssl):**
1. In-test TLS "tracker" (`node:tls` on `tracker.example.org:8443`, self-signed) + in-test https
   blocklist server (fixture CA installed via `update-ca-certificates`).
2. Create user via queue → provision chain (Phase 1 green baseline).
3. Craft a private `.torrent` (announcer `https://tracker.example.org:8443/announce`) → user shim
   `inserted_new` → worker drain → assert: `trackers` row exists (private, pending→checked),
   `/etc/ssl/certs/tracker.example.org.pem` installed, tracker promoted `isSsl=1`,
   whitelist rendered: `allow.p2p` contains `tracker.example.org:127.0.0.1-255.255.255.255` +
   user line; zones file has **no** entry (tracker active); re-run `render-whitelist` →
   0 changed files (idempotence).
4. `mark-tracker-dead tracker.example.org` → zones + blocked-names contain the host, allow.p2p
   does not; cert removed.
5. Blocklists: `import-blocklist-catalog` from local fixture XML → rows; enable one personal
   https list → `update-blocklists` → `/home/<user>/blocklist/blocklist_rtorrent.txt` +
   `80-blocklist.rc` rendered; restart `rtorrent-<user>` → journal/log contains the
   `IPv4 filter list size` print (real rtorrent parsed the filter). A second `update-blocklists`
   with the fixture server killed → old file kept, `BlocklistUpdateFailed` notified, exit green.
6. `renew-tracker-certs` with a fixture cert expiring today → re-fetch + `TrackerCertRenewed`.

**Commit:** `feat(tracker): full-stack E2E on Debian 12 (discovery, cert, whitelist, blocklist)`

## Task 12 — Verification, review, PR draft, Phase 3 brief

- `pnpm lint && pnpm typecheck && pnpm coverage && pnpm build` green locally (no `| tail` —
  zsh pipestatus trap).
- `make up && make test-int && make e2e` green in the Debian 12 container.
- superpowers:requesting-code-review on the full diff; fix findings
  (superpowers:receiving-code-review).
- Push branch; **draft PR** → `main`, <200 words, title `feat: Phase 2 — Tracker & Blocklist`,
  **no session URL in the body** (public repo rule).
- Write `docs/PHASE-3-BRIEF.md` (Security & Network + fair-use observability) mirroring the
  Phase 2 brief structure, and update the project memory.

---

**Guardrails reminder:** never touch prod or legacy dirs; neutral fixtures only
(`tracker.example.org`, `dead.example.net`, `alice`/`bob`, `198.51.100.0/24`, `192.0.2.0/24`
doc ranges); tests never reach the real network (iblocklist/list servers are local fixtures);
secrets (iblocklist pin) via env, never logged/committed; push only when local gates pass.
