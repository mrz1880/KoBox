# Phase 0 — User Management Vertical Slice — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute in-session per
> PHASE-0-BRIEF §6: TDD per unit, one commit per unit, one draft PR for the phase).

**Goal:** Build the KoBox Phase 0 vertical slice — User Management bounded context (create /
delete / change-password / suspend / resume) in TypeScript strict, hexagonal, SQLite+Drizzle,
with the full test pyramid green on a fresh Debian 12 container.

**Architecture:** Hexagonal under `kobox/` (strangler next to legacy MySB — legacy untouched).
`domain/` is dependency-free (VOs + aggregate + ports as interfaces). `application/` holds use
cases orchestrating ports, plus the typed Job seam (closed enum + Zod payloads) between the
unprivileged web/CLI side and the root worker. `infrastructure/` implements ports: Drizzle/SQLite
persistence, `execFile`-typed system adapters + in-memory fakes. `interfaces/` = commander CLI +
minimal root worker. Errors: typed `DomainError` subclasses thrown by VOs/aggregate ("parse,
don't validate"); Zod only at I/O boundaries (CLI args, job payloads).

**Tech Stack:** TypeScript strict (Node ≥24), pnpm, Vitest + fast-check, ESLint (typescript-eslint
strict), Drizzle ORM + better-sqlite3 (WAL), Zod, pino, commander, Docker `jrei/systemd-debian:12`
for integration/E2E, GitHub Actions CI.

**Locked decisions (do NOT re-debate — from docs/AUDIT.md + docs/PHASE-0-BRIEF.md):**
- TS strict, `any` forbidden, `readonly` constructor-only fields, optional chaining.
- Single SQLite (WAL) via Drizzle; no external queue (jobs table in SQLite).
- Domain imports nothing (no Zod, no Drizzle, no pino, no node builtins).
- No shell-string exec — `execFile` with argv only. No secrets logged/committed.
- Suspend/resume = reversible + idempotent, no data/account deletion.
- Port allocation atomic (DB transaction), never `max()+1` racy read-then-write.
- Quota invariant: `maxSettable = used + free` (legacy bug #72).
- Branch `feature/phase0-user-management` from `audit/initial-plan`. One commit per unit.
- Never touch prod; never touch legacy dirs (`install/ web/ inc/ bin/ scripts/ templates/ upgrade/`).

**Conventions:**
- Tests under `kobox/test/{unit,component,integration,contract,e2e}` mirroring `src/`.
- BDD-ish names: `should_reject_username_when_reserved`. Test Data Builders in
  `kobox/test/builders/`.
- Commit style: `feat|fix|test|chore|refactor: ...` + why-body + Co-Authored-By line.
- Run everything from `kobox/` with pnpm scripts; repo root stays legacy-pristine.

---

## Unit 1 — Branch + scaffold + toolchain (proof: a trivial VO test runs)

**Files:** `kobox/package.json`, `kobox/tsconfig.json`, `kobox/eslint.config.js`,
`kobox/vitest.config.ts`, `kobox/.gitignore`, `kobox/src/domain/shared/DomainError.ts`,
`kobox/test/unit/domain/shared/DomainError.test.ts`.

Steps:
1. `git checkout -b feature/phase0-user-management` (from `audit/initial-plan`).
2. `kobox/package.json`: private, `"type": "module"`, engines `node >=24`, scripts:
   `lint` (eslint), `typecheck` (tsc --noEmit), `test` (vitest run test/unit test/component),
   `test:unit`, `test:component`, `test:int` (vitest run test/integration),
   `test:contract`, `test:e2e`, `build` (tsc -p tsconfig.build.json), `coverage`.
   Deps: `drizzle-orm`, `better-sqlite3`, `zod`, `pino`, `commander`.
   DevDeps: `typescript`, `vitest`, `@vitest/coverage-v8`, `fast-check`, `eslint`,
   `typescript-eslint`, `drizzle-kit`, `@types/better-sqlite3`, `@types/node`.
3. `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, NodeNext.
4. `eslint.config.js` (flat): typescript-eslint `strictTypeChecked` +
   `@typescript-eslint/no-explicit-any: error`, `prefer-optional-chain: error`,
   `prefer-readonly: error`.
5. Failing test first: `DomainError` base class (name = constructor name, message).
6. Green, lint+typecheck green. Commit `chore: scaffold kobox TS strict toolchain`.

## Unit 2 — Username VO

**Files:** `kobox/src/domain/user/Username.ts`,
`kobox/test/unit/domain/user/Username.test.ts`.

Invariants: lowercase `[a-z][a-z0-9]*`, length 1..32, reserved list rejected
(`root, plex, ftp, www-data, admin, mysb, kobox, daemon, bin, sys, sync, mail, nobody, sshd`).
Shell-safe by construction (charset). Tests: property-based (fast-check) valid charset
accepted, uppercase/symbols/injection strings (`a;rm -rf`, `a$(x)`, `a|b`) rejected,
reserved rejected, equality by value. Throws `InvalidUsernameError`.
Commit `feat: Username value object with shell-safe invariants`.

## Unit 3 — EmailAddress, AccountType, UserStatus, UserId VOs

**Files:** `kobox/src/domain/user/{EmailAddress,AccountType,UserStatus,UserId}.ts` + tests.

- `EmailAddress`: pragmatic RFC-lite regex, lowercase-normalized, equality by value.
- `AccountType`: closed enum `normal | plex` (static `normal()`, `plex()`, `parse`).
- `UserStatus`: closed enum `active | suspended`.
- `UserId`: positive integer brand.
Commit `feat: user identity value objects`.

## Unit 4 — Quota VO (bug #72 invariant)

**Files:** `kobox/src/domain/user/Quota.ts` + unit test with fast-check.

Internal unit: **bytes** (bigint-free: number is safe ≤ 8 PiB, fine). `Quota.bytes(n)`,
`Quota.gib(n)`, `≥0`, `toGib()`. `Quota.maxSettable(usedByUser, freeOnDisk)` = used+free.
Property: for all used, free ≥ 0 → maxSettable ≥ used (a user can always keep what they have).
Commit `feat: Quota VO with maxSettable=used+free invariant (legacy bug #72)`.

## Unit 5 — Port VOs + PortAllocator port

**Files:** `kobox/src/domain/user/Port.ts` (base `Port` 1-65535 + branded
`ScgiPort`/`RtorrentPort`/`ProxyPort`), `kobox/src/domain/user/PortAllocatorPort.ts`
(interface: `allocateScgiPort(): Promise<ScgiPort>` etc. — atomicity is the adapter's
contract), unit tests property-based on range + equality.
Commit `feat: Port value objects and atomic allocator port`.

## Unit 6 — SeedboxUser aggregate + domain events

**Files:** `kobox/src/domain/user/SeedboxUser.ts`,
`kobox/src/domain/user/events.ts` (`UserCreated/UserDeleted/PasswordChanged/UserSuspended/UserResumed`),
tests.

Immutable aggregate (all fields readonly VOs). Static `create(...)` → `{user, event}`.
Methods return new state + event: `suspend()` (idempotent: suspending a suspended user
returns same state, no event), `resume()` (idempotent), `withQuota(q)`. No I/O, no ports
imported — pure.
Commit `feat: SeedboxUser immutable aggregate with domain events`.

## Unit 7 — Domain ports (interfaces)

**Files:** `kobox/src/domain/user/ports.ts`: `UserRepository` (findByUsername, findById,
save, delete, listAll, `nextUserWith(ports)` handled by allocator), `SystemAccountPort`
(createAccount, deleteAccount, setPassword, lockAccount, unlockAccount, accountExists,
isLocked), `QuotaPort` (setQuota, getUsage), `SftpPort` (enableChrootAccess,
disableChrootAccess, isChrootAccessEnabled), `ServiceControlPort` (stopUserService,
startUserService, isUserServiceRunning — the rtorrent seam), `NotificationPort`
(notify(event)), `HealthProbePort` (checkProcess, checkSocket). Types only — no test needed
beyond typecheck; covered by fakes' contract tests in Unit 8.
Commit `feat: domain ports for user management`.

## Unit 8 — In-memory fakes for all system ports

**Files:** `kobox/src/infrastructure/system/fakes/{FakeSystemAccounts,FakeQuota,FakeSftp,FakeServiceControl,FakeNotifications}.ts`,
`kobox/src/infrastructure/persistence/InMemoryUserRepository.ts`, behavior tests.

Fakes hold full in-memory behavior (accounts map with locked flag, quota map, chroot set,
service state map, notifications array). Tested directly (they're the contract every
adapter must satisfy).
Commit `feat: in-memory fakes for system and persistence ports`.

## Unit 9 — Use cases (component tests with fakes + builders)

**Files:** `kobox/src/application/user/{CreateUser,DeleteUser,ChangePassword,SuspendUser,ResumeUser}.ts`,
`kobox/test/builders/UserBuilder.ts`, component tests per use case.

- `CreateUser`: reject duplicate username → allocate ports atomically → system account →
  quota → chroot → save → notify(UserCreated). Password passed through, never stored in DB.
- `DeleteUser`: reverse teardown, idempotent-friendly errors.
- `ChangePassword`: system only (no DB password column — legacy stored varchar(32) plaintext;
  KoBox stores none).
- `SuspendUser`: lock account + disable chroot + stop rtorrent service + save status —
  **no deletion**; idempotent (already-suspended → no-op).
- `ResumeUser`: exact reverse; idempotent.
Commit `feat: user lifecycle use cases with reversible suspend/resume`.

## Unit 10 — Typed Job seam (application/jobs) + contract tests

**Files:** `kobox/src/application/jobs/{JobType,jobSchemas,Job}.ts`,
`kobox/test/contract/jobSchemas.test.ts` + snapshot of JSON schemas.

Closed enum: `create-user | delete-user | change-password | suspend-user | resume-user`.
One Zod payload schema per type; `parseJob(raw)` = defense-in-depth revalidation the worker
runs. Contract test snapshots the JSON schema shape (breaking-change detector in CI).
Commit `feat: typed job contract between unprivileged enqueuer and root worker`.

## Unit 11 — SQLite persistence (Drizzle) + atomic port allocator

**Files:** `kobox/src/infrastructure/persistence/{schema,db,SqliteUserRepository,SqlitePortAllocator,SqliteJobQueue}.ts`,
`kobox/drizzle.config.ts`, `kobox/drizzle/` migrations, integration tests vs real temp SQLite.

Schema (derived from PROD-INSPECTION: users w/ scgi 51101→, proxy shared, quota):
`users(id, username unique, email, account_type, quota_bytes, scgi_port unique,
rtorrent_port unique, proxy_port, status, created_at)`,
`jobs(id, type, payload_json, status pending|running|done|failed, error, created_at, updated_at)`.
`SqlitePortAllocator`: allocation inside a single `db.transaction` (better-sqlite3 is
synchronous → transaction is atomic; test concurrency by racing 50 allocations → all unique).
WAL enabled at open. Integration tests use `mkdtemp` DB files.
Commit `feat: SQLite persistence with Drizzle and atomic port allocation`.

## Unit 12 — Real system adapters (execFile, typed) + logging + health probe

**Files:** `kobox/src/infrastructure/system/{ExecFileRunner,SystemAccountAdapter,QuotaAdapter,SftpAdapter,SystemdServiceControlAdapter,ProcessSocketHealthProbe}.ts`,
`kobox/src/infrastructure/logging/logger.ts` (pino JSON),
`kobox/src/infrastructure/notifications/ConsoleNotificationAdapter.ts`.

`ExecFileRunner`: thin typed wrapper over `node:child_process.execFile` (argv array only,
stdin support for `chpasswd`, never logs argv containing secrets). Adapters:
- `SystemAccountAdapter`: `useradd -m -s /bin/bash -G kobox-users`, `userdel -r`,
  `chpasswd` via stdin, `usermod -L/-U`, `passwd -S` for lock state.
- `QuotaAdapter`: `setquota -u <user> 0 <blocks> 0 0 <fs>` + `quota -u`; degrades cleanly
  when quota tooling absent (reported, not silent).
- `SftpAdapter`: membership in `kobox-sftp` group (sshd `Match Group` chroot), via
  `usermod -aG` / `gpasswd -d`.
- `SystemdServiceControlAdapter`: `systemctl stop|start|is-active rtorrent-<user>`.
- `ProcessSocketHealthProbe`: pid alive + TCP socket connect (catches
  crashed-but-"active" rtorrent + silent-failed Minio from prod).
Unit-test the runner arg-building with an injected fake exec; real behavior covered in
integration (Unit 14 container).
Commit `feat: real system adapters via typed execFile + structured logging + health probe`.

## Unit 13 — CLI + root worker

**Files:** `kobox/src/interfaces/cli/main.ts` (+ per-command modules),
`kobox/src/interfaces/worker/main.ts`, `kobox/src/interfaces/composition.ts` (wiring),
component tests driving CLI command handlers with fakes, contract test for CLI arg schemas.

CLI (`commander`): `kobox create-user|delete-user|change-password|suspend-user|resume-user|doctor`.
Two modes: `--direct` (executes use case in-process — dev/root) and default **enqueue** mode
(writes typed Job; proves the unprivileged path). Password via `--password-stdin` only
(never argv). `doctor` runs health probes and prints JSON.
Worker: loop `claimNextPendingJob()` (transaction: pending→running), re-parse payload
(defense in depth), execute matching use case with real adapters, mark done/failed.
`--once` flag for tests/E2E. Component test: enqueue job → run worker once with fakes →
assert effect + job done.
Commit `feat: kobox CLI and root job worker (typed privilege boundary)`.

## Unit 14 — Debian 12 dev/test environment + integration of real adapters

**Files:** `docker/kobox-dev/Dockerfile` (FROM `jrei/systemd-debian:12` + node24 + quota +
openssh-server + sudo), `docker/kobox-dev/docker-compose.yml` (privileged, tmpfs /run /tmp,
cgroup, repo bind-mounted at `/opt/KoBox`), `Makefile` (root: `up shell test-int e2e down`),
`docs/DEV.md`.

Integration tests (run **inside** container, tagged, skipped on mac):
`SystemAccountAdapter` creates/locks/deletes a real user; `SftpAdapter` real group;
`SystemdServiceControlAdapter` against a throwaway unit; quota best-effort (tmpfs has no
ext4 quota → assert clean degradation; full quota check happens in E2E ext4 loopback image
if feasible, else documented).
Commit `feat: Debian 12 privileged dev environment and system-adapter integration tests`.

## Unit 15 — E2E on fresh Debian 12

**Files:** `kobox/test/e2e/user-lifecycle.e2e.test.ts`, `docker/kobox-dev/e2e-setup.sh`
(sshd chroot Match Group config, dummy `rtorrent-<user>` systemd unit template).

Scenario (single high-signal flow, real CLI + real worker inside container):
`create-user tonye2e` → OS account exists, in groups, quota recorded, sshd chroot config
matches, dummy rtorrent unit running → `suspend-user` → account locked (`passwd -S` = L),
sftp group removed, rtorrent unit stopped, DB status=suspended → SSH auth refused →
`resume-user` → everything restored (assert exact pre-suspend state) → `delete-user`.
Commit `test: E2E user lifecycle on fresh Debian 12`.

## Unit 16 — CI GitHub Actions

**Files:** `.github/workflows/kobox-ci.yml` (new file — does not touch legacy workflows).

Jobs: `fast` (push: pnpm install, lint, typecheck, unit+component, contract) < 2 min;
`integration` + `e2e` (PR: docker privileged Debian 12) < 15 min. Coverage gate ≥85 %
lines on `src/domain` + `src/application` (vitest coverage thresholds scoped).
Commit `chore: GitHub Actions CI for kobox (fast on push, container tests on PR)`.

## Unit 17 — Coverage check, review, draft PR

1. `pnpm coverage` → assert ≥85 % domain+application.
2. Invoke `requesting-code-review` skill; fix findings.
3. Push branch, open **draft** PR `feature/phase0-user-management → audit/initial-plan`
   (base = branch containing the docs), body <200 words. Do not merge.
4. Chat summary <200 words.

---

**Definition of DONE (from PHASE-0-BRIEF §7):** E2E green on fresh Debian 12
(create→suspend→resume with quota+chroot verified); full pyramid green; coverage >85 %
domain+application; CI green; `docs/DEV.md` written; draft PR open + <200-word summary.
