# Space cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** let a member free their quota by deleting torrents that seeded enough or
that KoBox sync already sent, on a click or automatically past 90 %.

**Architecture:** a new `space` bounded context in the domain owns the rule
(`SeedRule`), the reading of a member's pressure (`QuotaPressure`) and the
proposal (`CleanupProposal`). The hourly `sample-disk-usage` pass, which already
runs as root for every member, now also reads each member's finished torrents
over their SCGI and stores a snapshot the non-root portal reads. Deleting goes
through a `clean-up-space` job: the worker rechecks each torrent live, erases it
in rTorrent, then removes its data.

**Tech Stack:** TypeScript, Vitest, Drizzle (SQLite), Fastify SSR without client
JavaScript, zod job contract, XML-RPC over SCGI.

Design: `docs/plans/2026-11-02-quota-cleanup-design.md`.

---

## Ground rules for every task

- Work in `kobox/`. Strict TDD: one test, watch it fail for the right reason,
  minimum code, suite green, refactor. Run single files with
  `pnpm vitest run <path>`; check the exit code, never pipe a test run through
  `grep` with `&&`.
- Before modifying a function, grep its callers.
- Public repo: fixtures use `alice`, `bob`, `example.org`. No em dash in code,
  comments or commits. No Claude attribution in commits.
- After a CSS or view change: `UPDATE_GOLDEN=1 pnpm vitest run
  test/unit/interfaces/http/pages.test.ts`, then read the diff.
- Every user-facing string goes through `viewer.t(...)` and gets its French
  entry in `src/interfaces/http/views/messages.ts`.
- Cleanups found on the way are separate `refactor:`/`test:` commits.

## Delivery in three pull requests

1. **PR A, manual cleanup end to end** (Tasks 1 to 12): domain, SCGI read and
   erase, snapshot in the hourly pass, the page, the home box, the job. The
   seed rule is read from a repository that falls back to the default.
2. **PR B, the 90 % mail and automatic cleanup** (Tasks 13 to 17).
3. **PR C, the admin side** (Tasks 18 to 20): the seed rule form and what an
   admin sees per member.

Each PR ends with the full suite (`pnpm test`, `pnpm test:int`), lint and
typecheck, then `pnpm test:e2e` in the container for PR A (see memory
`e2e-run-locally-first`).

---

## PR A: manual cleanup

### Task 1: `SeedRule`

**Files:**
- Create: `src/domain/space/SeedRule.ts`
- Test: `test/unit/domain/space/SeedRule.test.ts`

Behaviors, one RED/GREEN each:
1. `SeedRule.of({ ratio: 0, days: 7 })` throws `InvalidSeedRuleError` (ratio
   must be above 0).
2. `days: 0` throws (at least one day). Non-integer days throw.
3. `SeedRule.DEFAULT` is ratio 2, 7 days (named constants `DEFAULT_RATIO`,
   `DEFAULT_DAYS` in this module, nowhere else).
4. `rule.isMetBy({ ratio, finishedAt }, now)`: true at ratio 2.0 finished
   exactly 7 days ago, false at 1.99, false at 6 days 23 h. Dates are ISO
   strings; the comparison uses `Date.parse` once.

```ts
export class SeedRule {
  static readonly DEFAULT = new SeedRule(DEFAULT_RATIO, DEFAULT_DAYS);
  private constructor(readonly ratio: number, readonly days: number) {}
  static of(raw: { ratio: number; days: number }): SeedRule { /* validate */ }
  isMetBy(torrent: { ratio: number; finishedAt: string }, now: string): boolean { /* ... */ }
}
```

Commit: `feat(space): a seed rule that says when a torrent has seeded enough`

### Task 2: `QuotaPressure`

**Files:**
- Create: `src/domain/space/QuotaPressure.ts`
- Test: `test/unit/domain/space/QuotaPressure.test.ts`

`QuotaPressure.of(used: Quota, allowance: Quota)` returns `'relaxed' | 'filling'
| 'critical'`. Table-driven test at 79 %, 80 %, 89 %, 90 %, 100 %, and a zero
allowance (critical). The two thresholds `FILLING_FROM = 0.8` and
`CRITICAL_FROM = 0.9` live here. Also `targetUsage(allowance): Quota`, the
usage at the 80 % line, used by the proposal.

Commit: `feat(space): tell how close a member is to their quota`

### Task 3: `CleanupCandidate` and its reasons

**Files:**
- Create: `src/domain/space/CleanupCandidate.ts`
- Test: `test/unit/domain/space/CleanupCandidate.test.ts`

Input is a `FinishedTorrent` read model (infoHash, name, size as `Quota`,
ratio, finishedAt, path) plus the set of paths already sent. Static
`CleanupCandidate.judge(torrent, { rule, sentPaths, now })` returns a candidate
or `undefined`.
1. Ratio and age met → reason `seeded`.
2. Path in `sentPaths` → reason `alreadySent` (wins over `seeded` when both
   hold: it is the stronger reassurance for the member).
3. Neither → `undefined`.
4. A torrent without a finish date (rTorrent reports 0) → `undefined`, even if
   sent: it is still downloading.

Commit: `feat(space): decide which finished torrent can go, and why`

### Task 4: `CleanupProposal`

**Files:**
- Create: `src/domain/space/CleanupProposal.ts`
- Test: `test/unit/domain/space/CleanupProposal.test.ts`

`CleanupProposal.of({ candidates, used, allowance })`:
1. Orders by ratio bucket then size: the most seeded first, the largest first
   within equal standing. Define the order with one comparator and test it with
   three candidates.
2. `lines` carry `checked: true` until the running total brings `used` under
   `QuotaPressure.targetUsage`, then `false`.
3. `freed(selection?)`: total of the checked lines, or of an explicit list of
   info hashes (the member unchecked some).
4. Empty candidates → empty proposal, `freed` is zero.

Commit: `feat(space): propose what to clean, largest first, down to 80 %`

### Task 5: SCGI read of finished torrents

**Files:**
- Modify: `src/domain/torrent/ports.ts` (new `FinishedTorrentsPort` next to
  `RtorrentControlPort`, consumer-owned: `listFinished(scgiPort)`), or better
  `src/domain/space/ports.ts` since `space` is the consumer.
- Modify: `src/infrastructure/system/ScgiRtorrentControlAdapter.ts`
- Test: `test/unit/infrastructure/system/torrent-adapters.test.ts` (fake SCGI
  server already used there), integration against real rtorrent in E2E later.

The private `call` only sends one string param and resolves `void`. Refactor
first (separate `refactor:` commit, tests green): `call` returns the response
body, takes a list of params. Then:
- `d.multicall2` with params `''`, `'complete'`, `'d.hash='`, `'d.name='`,
  `'d.size_bytes='`, `'d.ratio='`, `'d.timestamp.finished='`, `'d.base_path='`.
- Parse the XML-RPC array of arrays. `d.ratio` is in thousandths: divide by 1000
  here, at the boundary. `d.timestamp.finished` is epoch seconds: convert to ISO.
  Names come back XML-escaped: unescape.
- A malformed row is skipped and logged, never thrown: one odd torrent must not
  blind the whole snapshot.

Tests: a canned response with two torrents parses to two `FinishedTorrent`; a
fault rejects with `RtorrentFaultError`; a row with a bad hash is skipped.

Commits: `refactor(rtorrent): let an SCGI call carry several params and return
its answer`, then `feat(rtorrent): read a member's finished torrents with their
ratio and size`.

### Task 6: SCGI erase

Same files. `erase(scgiPort, infoHash)` sends `d.erase`. The existing
`erased` hook then deletes the `torrents` row through `HandleTorrentEvent`, so
nothing else has to. Test with the fake server: the method name and param sent.

Commit: `feat(rtorrent): erase a torrent from a member's rTorrent`

### Task 7: removing a torrent's data safely

**Files:**
- Create: `src/domain/space/ports.ts` (`TorrentDataPort.remove(username, path)`)
- Create: `src/infrastructure/system/FsTorrentDataAdapter.ts`
- Test: `test/integration/system/FsTorrentDataAdapter.test.ts` (temp dir)

Rules, each its own test:
1. Removes a file or a folder recursively under the member's download folder.
2. Refuses a path outside it (`PathOutsideMemberSpaceError`), resolved with
   `realpath` so `..` and symlinked parents cannot escape.
3. The target itself being a symbolic link: removes the link, never what it
   points to.
4. An already missing path resolves (idempotent).

Find the member's download root from `homeOf(username)` (and the same layout
`HandleTorrentEvent` checks against); do not retype the path.

Commit: `feat(space): remove a torrent's files, only inside the member's space`

### Task 8: snapshot storage

**Files:**
- Modify: `src/infrastructure/persistence/schema.ts` (table
  `cleanup_snapshots`: username, info_hash, name, size_bytes, ratio_milli,
  finished_at, path, reason, taken_at; primary key (username, info_hash)) and
  table `seed_rule` (one row id 1: ratio_milli, days).
- Generate: `npx drizzle-kit generate --name space-cleanup` (0034).
- Create: `src/infrastructure/persistence/SqliteCleanupSnapshotRepository.ts`,
  `SqliteSeedRuleRepository.ts`
- Ports in `src/domain/space/ports.ts`: `CleanupSnapshotRepository`
  (`replace(username, candidates, takenAt)`, `find(username)`),
  `SeedRuleRepository` (`get(): SeedRule` falling back to `SeedRule.DEFAULT`,
  `save(rule)`).
- Test: `test/integration/persistence/` round trips; replacing drops the old
  rows; the migration test in `db.test.ts` gains the new tables.

Commit: `feat(space): keep the latest cleanup snapshot of each member`

### Task 9: the hourly pass takes the snapshot

**Files:**
- Create: `src/application/space/TakeCleanupSnapshot.ts`
- Modify: `src/application/user/SampleDiskUsage.ts` (sprout: one call per
  member after the sample is saved), the composition root that builds it.
- Test: `test/unit/application/space/TakeCleanupSnapshot.test.ts` with fakes;
  extend `test/component/application/user/user-lifecycle.test.ts` only if it
  builds `SampleDiskUsage`.

`TakeCleanupSnapshot.execute(user, at)`: finds the member's `TorrentInstance`
(SCGI port), reads finished torrents, reads sent `SyncTransfer` sources, judges
each with the rule, replaces the snapshot. An unreachable rTorrent leaves the
previous snapshot untouched (test it) and never fails the pass for the others.

Commit: `feat(space): take each member's cleanup snapshot with the hourly sample`

### Task 10: the `clean-up-space` job and use case

**Files:**
- Modify: `src/application/jobs/contract.ts` (`'clean-up-space'`: username,
  `infoHashes` array of `infoHashField`, 1 to 500), `src/interfaces/cli/buildJob.ts`,
  `src/interfaces/worker/JobWorker.ts`, contract tests in `test/contract`.
- Create: `src/application/space/CleanUpSpace.ts`
- Test: `test/unit/application/space/CleanUpSpace.test.ts`

Behaviors:
1. Each listed torrent is read live; one that still qualifies is erased in
   rTorrent, then its data removed.
2. One that no longer qualifies (not finished, ratio dropped below after a
   restart, now being sent) is skipped, and the report names the reason.
3. An info hash not in the member's rTorrent is skipped as gone.
4. A data removal failure is reported and the pass goes on.
5. Afterwards usage is measured again and the sample saved, then the snapshot
   is retaken, so the page and gauge are current.
6. The report (`CleanupReport`: deleted lines with sizes, skipped lines with
   reasons, freed total, at) is saved for the member (table
   `cleanup_reports`, latest one per member, same migration if not merged yet,
   otherwise 0035).

Commit: `feat(space): delete the chosen torrents after checking each one again`

### Task 11: the `/space/cleanup` page

**Files:**
- Create: `src/interfaces/http/views/spaceCleanupPage.ts`
- Modify: `src/interfaces/http/routes/user.ts` (GET and POST
  `/space/cleanup`), `views/messages.ts`, `test/unit/interfaces/http/pages.test.ts`
  plus golden.
- Test: route tests next to the existing user route tests.

- GET without query: lines checked as the proposal says. GET with
  `?keep=<hash>&keep=...` from the "Recalculate" button: those stay checked,
  the total follows. One form, two submit buttons: "Recalculate" (GET) and
  "Delete for good (N GiB)" (POST with CSRF).
- Each line: name, size (`formatBytes`), ratio, finished date, reason text. A
  line proposed for having seeded adds "KoBox does not know whether you fetched
  it".
- Snapshot date shown; no snapshot yet → "The first list arrives within the
  hour".
- POST enqueues `clean-up-space` and redirects with a flash; the latest report
  is shown at the top of the page.
- Nothing cleanable → the sentence from the design.

Commit: `feat(portal): show a member what can be cleaned and delete it on a click`

### Task 12: the home box

**Files:**
- Modify: `src/interfaces/http/views/userPages.ts` (`userHomePage`),
  `views/space.ts` if the box sits with the gauge, the GET `/` route to pass the
  snapshot total, CSS, golden.

Under 80 %: a discreet link. From 80 % (`QuotaPressure`): the highlighted box
with the freeable total and the button. Nothing cleanable: the sentence. Test
the three states through the rendered page.

Commit: `feat(portal): point a member at the cleanup once they pass 80 %`

**PR A gate:** full suite, `pnpm test:int`, lint, typecheck, then the E2E path:
add to `test/e2e/torrent-lifecycle.e2e.test.ts` a seeded torrent (rule lowered
through the repository), the hourly pass, the job, and assert the files and the
rTorrent entry are gone. Open the PR; merge and release only when asked.

---

## PR B: the 90 % mail and automatic cleanup

### Task 13: member preferences

**Files:** table `space_preferences` (username unique, automatic scope text
`'off' | 'sentOnly' | 'sentOrSeeded'` default `'off'`, warned int default 0),
domain union `AutomaticCleanup` with its parse, repository, port
`SpacePreferenceRepository`, migration.

Commit: `feat(space): remember a member's cleanup choice and whether they were warned`

### Task 14: `SpaceWarning`, once per climb

**Files:** `src/domain/space/SpaceWarning.ts`, test.

Pure transition: `(warned, pressure) → { warned, send }`. Critical and not
warned → send, warned. Relaxed → reset. Filling keeps the current state (no
resend between 80 and 90 %). Table test.

Commit: `feat(space): warn a member once each time they climb past 90 %`

### Task 15: `WatchMemberSpace` in the hourly pass

**Files:** `src/application/space/WatchMemberSpace.ts`, wired after
`TakeCleanupSnapshot` in `SampleDiskUsage`, test with fakes.

- Critical, not warned, automatic off → enqueue the mail in the outbox
  (`MailOutboxPort`, the durable queue, so no extra job type) to the member's
  address: usage, freeable total, link. Nothing freeable → the "nothing to
  clean" variant.
- Critical, automatic on, snapshot younger than two hours (`STALE_AFTER_MS`
  here) → enqueue `clean-up-space` with the lines a proposal built only from the
  candidates the scope allows checks (`sentOnly`: reason `alreadySent` only;
  `sentOrSeeded`: both). The scope rule lives in the domain. Nothing freeable or a
  stale snapshot → the ordinary mail.
- Mail texts live in a `spaceMails.ts` next to `passwordLinkMail.ts`, in the
  member's language like the other member mails.

Update the design doc's Flow paragraph: the mail goes straight to the outbox.

Commit: `feat(space): mail a member past 90 %, or clean up for them if they chose it`

### Task 16: the automatic report

`CleanUpSpace` gains a `trigger: 'member' | 'automatic'` field in the job
payload (an enum, not a boolean). Automatic → one mail listing what went and
the space given back. The home shows the latest automatic report for
`REPORT_SHOWN_FOR_DAYS = 7`. Tests on both.

Commit: `feat(space): tell a member what automatic cleanup deleted`

### Task 17: the setting in My account

**Files:** job `set-automatic-cleanup` (username, scope), use case,
`accessPage` section with three choices (off, what KoBox sent, what KoBox sent
or what seeded enough) and the warning that the third can delete files never
fetched, POST route, messages, golden.

Commit: `feat(portal): let a member turn on automatic cleanup`

**PR B gate:** suites, lint, typecheck. Open the PR.

---

## PR C: the admin side

### Task 18: `set-seed-rule` job and use case

Contract (ratio as a decimal 0.1 to 100, days 1 to 365), `SetSeedRule`, worker
case, test. The VO stays authoritative; zod only mirrors the shape.

Commit: `feat(space): let an admin set the box-wide seed rule`

### Task 19: the rule form

Where the members are managed (`adminUsersPage.ts`), a small form with the two
fields and the current values, POST route, messages, golden.

Commit: `feat(portal): set the seed rule from the members page`

### Task 20: what an admin sees per member

On the members page, per member: used of quota and the freeable total from the
snapshot, no delete button. Test through the rendered page.

Commit: `feat(portal): show an admin how much each member could free`

**PR C gate:** suites, lint, typecheck. Open the PR.

---

## Known traps

- `d.erase` fires the `erased` hook, which already deletes the `torrents` row:
  do not delete it twice.
- The portal is non-root and cannot reach another account's SCGI: everything it
  shows comes from the snapshot.
- The torrent's `tree` (from `d.base_path`) is the path a `SyncTransfer` stores
  as `source`; compare them as `LocalPath` values, not raw strings.
- `/home` on the production box is RAID0: deletion is final, there is no other
  copy. The page wording must not soften that.
