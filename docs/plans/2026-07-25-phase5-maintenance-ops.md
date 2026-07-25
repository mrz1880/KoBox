# Phase 5 — Maintenance & Ops Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute in-session) with
> superpowers:test-driven-development for every task. One commit per task.

**Goal:** Make an installed KoBox box live over time (AUDIT §1.7 + §5.6 + §6 phase 5): a
declarative scheduler replacing the legacy 26-line root cron + `MySB_jobs_check` watchdog, a
durable mail outbox with retry/backoff over the Postfix relay, a `letsencrypt` component
replacing the Phase 4 snakeoil cert, **transactional versioned upgrades** (`kobox upgrade`,
anti-`GitHubRepoUpdate`/`UpgradeMe`), TTL-rotated backups with a tested restore path, and the
pgl→ipset debt decision — all through the existing typed job queue (the scheduler enqueues,
the root worker executes).

**Architecture:** New hexagonal context `kobox/src/domain/maintenance/` (CronSchedule VO,
scheduled-jobs catalog, outbox retry policy, backup rotation plan, upgrade plan — all pure) /
`application/maintenance/` (SendMails, RunBackup, UpgradeRelease use cases + `scheduler`,
`letsencrypt`, `ipset` component installers extending the Phase 4 catalog) / infrastructure
adapters (`GitPort` argv-only, `CertbotPort`, `IpsetPort`, `SqliteMailOutbox`, sendmail
transport shared with the Phase 3 `EmailChannel`). Schema grows `mails` + `releases` tables
(additive migration). `JobType` grows `send-mails`, `run-backup`, `apply-ipset`.

**Tech Stack:** TypeScript strict, Drizzle/SQLite WAL, Zod, vitest + fast-check, golden files,
Debian 12 systemd container; pebble (letsencrypt/pebble docker image, `PEBBLE_VA_ALWAYS_VALID`)
as the local ACME fixture for the E2E — never the real Let's Encrypt endpoints.

**Locked decisions honored:** no `any`, `readonly`, optional chaining; execFile argv-only; VOs at
boundaries; declarative desired state, idempotent, golden-tested; never `>` on an edited file;
upgrades transactional/versioned — never `git reset --hard` on the running tree, never a forced
reboot, exit codes propagated; the scheduler enqueues typed jobs only (worker stays the sole
privileged executor); a missed tick catches up at the next tick (jobs already idempotent);
neutral fixtures; prod and legacy MySB untouched; apt/certbot real only in container/VM.

**Decisions taken by this plan (implementation choices, not re-litigated architecture):**

1. **Scheduler = one rendered `/etc/cron.d/kobox`** (not systemd timers). One golden file beats
   ~12 timer/service unit pairs; cron ships active on Debian 12; every entry runs an existing
   `kobox <job>` CLI command as root which *enqueues* a typed job (parse + INSERT — no
   privileged work inside cron's context). Missed ticks need no `Persistent=true`: the next
   tick converges (jobs idempotent). The legacy watchdog dies: `cron.service` and
   `kobox-worker.service` are both systemd-supervised (`Restart=`).
2. **Schedule parity table** (vs PROD-INSPECTION §2):
   | legacy | KoBox entry |
   |---|---|
   | DynamicAddressResolver `*/5` | `*/5` → `kobox resolve-dyndns` |
   | SendMails `*/5` | `*/5` → `kobox send-mails` |
   | LogServerAndQuota hourly + fair-use responsiveness | `*/5` → `kobox evaluate-fair-use` |
   | BlocklistsRTorrent + PeerGuardian update `0 */6` | `0 */6` → `kobox update-blocklists` |
   | GetTrackersCert `10 0` daily | `10 0` → `kobox renew-tracker-certs` |
   | Backup-Manager daily | `30 5` daily → `kobox run-backup` |
   Dropped with rationale: per-user `.rTorrent_tasks status` ×8 and `DNScrypt-proxy check`
   (systemd `Restart=` supervises those units now); `PeerGuardian check` (pgl retired, see
   decision 6); `LetsEncrypt renew` (Debian `certbot.timer` is the native renew path);
   `GitHubRepoUpdate`/`UpgradeMe`/`UpgradeSystem` (auto-self-update **is** the §5.6
   anti-pattern — replaced by operator-run `kobox upgrade`); `PaymentReminder` (billing
   out of v1); `NextCloud scan` (component lands with the vendored extras, deferred).
3. **Scheduler-idempotent enqueue:** cron-driven CLI commands use a new
   `JobQueuePort.enqueueUnique(job)` — skip when an identical `(type, payload)` job is already
   `pending`, so a stopped worker never accumulates a duplicate backlog.
4. **Outbox** rides a `mails` table; the Phase 3 email notification channel becomes
   durable-by-default (writes a row; the 5-min `send-mails` job flushes via the same sendmail
   transport). Backoff fixed: attempts→delay 5 min, 30 min, 2 h, 12 h, then status `failed`
   (5 attempts). SMTP relay credentials via a **direct-only** root CLI
   (`kobox configure-mail-relay`, password on stdin): `postconf` for relayhost/sasl settings +
   `/etc/postfix/sasl_passwd` 0600 + `postmap` — a secret never transits the jobs table.
5. **Upgrades = versioned worktrees + atomic symlink switch.** `/opt/kobox/current` (symlink)
   is what `kobox-worker.service` executes; `kobox upgrade --to <ref>` stages
   `git worktree add <releases>/<ref>` from the source checkout (fetch first; never mutates the
   running tree), `pnpm install --frozen-lockfile` + `pnpm build` in the staged tree, DB backup,
   explicit `kobox migrate` with the *staged* build, then an atomic symlink flip
   (`ln -sfn` + `rename(2)` via temp link) and worker restart with health verification. Any
   failure before the flip leaves `current` untouched; a failed post-flip restart flips back
   automatically. `kobox upgrade --rollback` returns to the previous release. History in a
   `releases` table. Migrations must stay **additive** (rollback keeps the migrated DB; the
   pre-upgrade backup covers disasters).
6. **pgl is retired; ipset replaces it** (debt #1 decision — flagged for owner validation in the
   PR). Prod's pgl actively drops traffic (44 805 packets, PROD-INSPECTION §2), so kernel-level
   enforcement is kept: `apply-ipset` renders `/etc/kobox/blocklist.ipset` (atomic
   staging-set + `swap` pattern, `hash:net` sized `maxelem 1048576`) from the Phase 2 merged
   blocklist cache, chained after `update-blocklists`; the Phase 3 firewall gains one INPUT rule
   `-m set --match-set kobox-bl src -j DROP` and the boot oneshot restores the set before the
   rules. Containers without the `ip_set` kernel module skip honestly (VM validates for real).
   `pgl` leaves the catalog (registry row cleaned up by migration).
7. **Let's Encrypt**: `letsencrypt` component (depends on nginx), env-driven —
   `KOBOX_LE_DOMAIN`/`KOBOX_LE_EMAIL` unset ⇒ honest skip with guidance (snakeoil stays).
   Webroot mode against a new port-80 ACME server block in the nginx vhost; deploy hook
   `/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx` reloads nginx; renewals via the packaged
   `certbot.timer`. `KOBOX_ACME_URL` + `KOBOX_ACME_CA_BUNDLE` point certbot at the pebble
   fixture in tests.
8. **Backups**: `/var/backups/kobox/<UTC-stamp>/` (0700 root) holding the SQLite online
   `.backup` plus tar.gz of `/etc/kobox` and `/etc/letsencrypt`; rotation = pure
   `planBackupRotation(existing, now, ttlDays=7, keepMin=3)`. Restore = documented + tested
   `kobox restore-backup <dir> --yes` (direct root; worker stopped during restore).
9. **ruTorrent pin (debt #2)**: stays env-driven; the *process* (how to pin + how upgrades
   re-pin) is documented in the new `docs/OPS.md`. resolv.conf switch to local bind (debt #4)
   documented there too. VPN CRL (debt #3) and vendored extras (Samba/NFS, ShellInABox,
   Webmin/Seedbox-Manager/Cakebox) are **deferred to Phase 6-** — the core ops loop is this
   phase's value; extras are independent components that fit any later slice.

**Out of scope:** portal SSR + app auth (Phase 6), prod data migration/cutover (post-6),
billing (out of v1), vendored extras + VPN CRL (deferred, see decision 9).

**Branch:** `feature/phase5-maintenance-ops` from `main`.

---

## Task 1 — Maintenance domain: `CronSchedule` VO + scheduled-jobs catalog + cron.d render

**Files:**
- Create: `kobox/src/domain/maintenance/CronSchedule.ts`, `schedule.ts`, `rendering.ts`
- Test: `kobox/test/unit/domain/maintenance/cron-schedule.test.ts`,
  `kobox/test/golden/maintenance/cron-kobox.golden` (+ `rendering.test.ts`)

**Specs:**
- `CronSchedule.parse(raw)`: restricted five-field grammar — each field `*`, `*/n`, or a plain
  number within range (minute 0-59, hour 0-23, dom 1-31, month 1-12, dow 0-7). Anything else
  (names, ranges, lists) throws `InvalidCronScheduleError` (DomainError). `value` returns the
  canonical five-field string. fast-check: garbage/shell-metacharacter strings never parse.
- `SCHEDULED_JOBS` (schedule.ts): closed readonly catalog `{ schedule: CronSchedule, command:
  string }` mirroring the parity table in decision 2 (commands are `kobox <subcommand>` words
  only — validated `/^[a-z0-9-]+$/` per word). Order = file order.
- `renderCronFile(settings: { koboxBin: string })` → `RenderedFile` for `/etc/cron.d/kobox`
  (0644 root:root): header comment, `PATH=/usr/sbin:/usr/bin:/sbin:/bin`,
  `SHELL=/bin/sh`, then one line per entry `<schedule> root <koboxBin> <subcommand>`.
  Golden-tested with `koboxBin=/usr/local/bin/kobox`.

**TDD:** red (parse/render tests) → green → golden snapshot reviewed by hand before commit.

**Commit:** `feat(maintenance): CronSchedule VO, scheduled-jobs catalog and cron.d rendering`

## Task 2 — Job contract: `send-mails`, `run-backup`, `apply-ipset` + `enqueueUnique`

**Files:**
- Modify: `kobox/src/application/jobs/contract.ts` (extend `JOB_TYPES` + empty-object payloads),
  `kobox/src/application/jobs/JobQueuePort.ts`, `kobox/src/infrastructure/persistence/SqliteJobQueue.ts`,
  `kobox/src/interfaces/cli/buildJob.ts`
- Test: extend `kobox/test/contract/jobs.contract.test.ts` (or current contract suite),
  `kobox/test/integration/persistence/job-queue.test.ts`

**Specs:** three new types with `z.strictObject({})` payloads; `buildJob.sendMails()`,
`runBackup()`, `applyIpset()`. `enqueueUnique(job)` on the port + Sqlite impl:
`INSERT ... WHERE NOT EXISTS (same type + payload_json + status='pending')` inside the write
transaction; returns the new id or `undefined` when deduped. In-memory/fake queues used by
component tests gain the same method.

**Commit:** `feat(jobs): maintenance job types and duplicate-free scheduler enqueue`

## Task 3 — Outbox schema + repository + retry policy

**Files:**
- Modify: `kobox/src/infrastructure/persistence/schema.ts` (+`mails`), generate
  `kobox/drizzle/0005_phase5-maintenance-ops.sql` (hand-reviewed — Phase 3 lesson)
- Create: `kobox/src/domain/maintenance/outbox.ts` (types + `nextAttemptDelay`),
  `kobox/src/application/maintenance/MailOutboxPort.ts`,
  `kobox/src/infrastructure/persistence/SqliteMailOutbox.ts` + `InMemoryMailOutbox.ts`
- Test: `kobox/test/unit/domain/maintenance/outbox-policy.test.ts`,
  `kobox/test/integration/persistence/mail-outbox.test.ts`

**Specs:**
- `mails`: id, recipient, subject, body, status `pending|sent|failed`, attempts (default 0),
  nextAttemptAt, lastError, createdAt, sentAt. The same migration file also drops the `pgl`
  registry row (`DELETE FROM components WHERE name='pgl'`) and creates `releases` (Task 8) —
  one additive migration for the phase.
- Domain policy (pure): `BACKOFF_MINUTES = [5, 30, 120, 720]`; `nextAttemptDelay(attempts)`
  returns minutes or `undefined` when attempts ≥ 5 (⇒ `failed`). Unit-tested exhaustively.
- Port: `enqueue(mail)`, `claimDue(now, limit)`, `markSent(id, now)`,
  `markRetry(id, error, nextAttemptAt)`, `markFailed(id, error)`, `listRecent(limit)`.

**Commit:** `feat(maintenance): durable mail outbox (schema, repository, retry policy)`

## Task 4 — `SendMails` use case + outbox-backed notification channel

**Files:**
- Create: `kobox/src/application/maintenance/SendMails.ts`,
  `kobox/src/infrastructure/notifications/OutboxEmailChannel.ts`,
  `kobox/src/infrastructure/notifications/SendmailTransport.ts`
- Modify: `kobox/src/infrastructure/notifications/EmailChannel.ts` (delegate to transport),
  `kobox/src/interfaces/composition.ts` (email channel → outbox), worker wiring
  (`JobWorker.execute` case `send-mails`), CLI `kobox send-mails` (enqueueUnique)
- Test: `kobox/test/component/maintenance/send-mails.test.ts`

**Specs:** `SendmailTransport` owns the `sendmail -t` invocation (extracted from
`EmailChannel`, byte-for-byte same message format). `OutboxEmailChannel` implements
`NotificationChannel` by inserting a pending row (recipient from settings). `SendMails.execute
({ now })`: claim due mails (limit 20/run), send via transport; success → `markSent`; failure →
policy decides retry (`markRetry` with computed nextAttemptAt) or terminal `markFailed`. Report
`{ sent, retried, failed }`. Component tests with a failing fake transport prove the backoff
ladder and the terminal state; a sent mail is never re-claimed.

**Commit:** `feat(maintenance): SendMails flushes the outbox with retry and backoff`

## Task 5 — SMTP relay configuration (direct-only CLI)

**Files:**
- Modify: `kobox/src/domain/installation/ports.ts` (`InstallHostPort` + `postmap(path)`),
  the `InstallHostAdapter` in `kobox/src/infrastructure/system/`, CLI `main.ts`
- Create: `kobox/src/application/maintenance/ConfigureMailRelay.ts`
- Test: `kobox/test/component/maintenance/configure-mail-relay.test.ts`,
  extend `kobox/test/integration/system/install-host.test.ts` (postmap against real postfix
  tools in container)

**Specs:** `kobox configure-mail-relay --host <fqdn> --port <n> --user <login>` (password
stdin): writes `/etc/postfix/sasl_passwd` (0600 root:root, content
`[host]:port user:password`) via `ManagedFilesPort`, runs `postmap` on it, then `postconf`:
`relayhost=[host]:port`, `smtp_sasl_auth_enable=yes`,
`smtp_sasl_password_maps=hash:/etc/postfix/sasl_passwd`, `smtp_sasl_security_options=noanonymous`,
`smtp_tls_security_level=encrypt`; reload postfix. Direct root only (no job — secrets stay out
of the DB). Password is never logged; component test asserts the fake runner saw no password in
argv (stdin only via the files port content) — the file content is the one place it lives.

**Commit:** `feat(maintenance): configure-mail-relay wires Postfix SASL credentials (0600, postmap)`

## Task 6 — `scheduler` component installer + catalog entry

**Files:**
- Modify: `kobox/src/domain/installation/ComponentName.ts` (+`scheduler`, `letsencrypt`,
  `ipset`; −`pgl`), `catalog.ts` (scheduler dependsOn kobox-core; letsencrypt dependsOn nginx;
  ipset standalone; drop pgl), `kobox/src/application/installation/installers.ts`
  (SchedulerInstaller; delete PglInstaller), CLI `run-backup` command (enqueueUnique)
- Test: extend `kobox/test/unit/domain/installation/*.test.ts`,
  `kobox/test/component/installation/installers.test.ts`, golden from Task 1

**Specs:** SchedulerInstaller: ensure `cron` package, render `/etc/cron.d/kobox` via
`ManagedFilesPort` (diff-only), `systemd.enable('cron', { now: true })`; uninstall removes the
file only. `KOBOX_BIN` (existing env, default `/usr/local/bin/kobox`) feeds `koboxBin`.
Catalog/plan unit tests updated for the new component set. The Phase 4 E2E expectations for
`pgl` move to `ipset` (may stay `skipped` in container — see Task 10).

**Commit:** `feat(installation): scheduler component renders the declarative cron.d (legacy 26-line cron parity)`

## Task 7 — Backups: rotation domain + `RunBackup` + restore path

**Files:**
- Create: `kobox/src/domain/maintenance/backup.ts` (`planBackupRotation`),
  `kobox/src/application/maintenance/RunBackup.ts`, `RestoreBackup.ts`,
  `kobox/src/application/maintenance/BackupHostPort.ts`,
  `kobox/src/infrastructure/system/BackupHostAdapter.ts`
- Modify: worker (`run-backup` case), CLI (`run-backup` enqueue, `restore-backup --yes` direct),
  composition
- Test: `kobox/test/unit/domain/maintenance/backup-rotation.test.ts`,
  `kobox/test/component/maintenance/run-backup.test.ts`,
  `kobox/test/integration/system/backup.test.ts` (real sqlite `.backup` + tar in container)

**Specs:**
- `planBackupRotation(stamps, now, { ttlDays: 7, keepMin: 3 })` (pure): returns stamps to
  delete — older than TTL **and** beyond the newest `keepMin`. Property test: never deletes
  down below keepMin, never deletes anything younger than TTL.
- `BackupHostPort`: `sqliteBackup(destPath)` (better-sqlite3 online `.backup` — WAL-safe),
  `archiveDir(srcDir, destTarGz)` (argv `tar -czf`, skipped when src missing),
  `listBackups(root)`, `removeBackup(root, stamp)`, `ensureDir`.
- `RunBackup.execute({ now })`: create `/var/backups/kobox/<YYYYMMDDTHHMMSSZ>/` 0700 with
  `kobox.db`, `etc-kobox.tar.gz`, `etc-letsencrypt.tar.gz` (when present), then apply rotation.
  Report `{ created, deleted }`.
- `RestoreBackup` (direct root, `--yes` required): stop `kobox-worker`, copy the backup DB over
  `KOBOX_DB` (the live DB is first moved aside to `<db>.pre-restore`, never deleted), restart
  worker. Prints what it did. Integration test: backup → mutate DB → restore → original row
  visible again.

**Commit:** `feat(maintenance): TTL-rotated backups (SQLite .backup + config archives) and tested restore`

## Task 8 — Upgrade foundations: `releases` table, `GitPort`, current-symlink layout

**Files:**
- Modify: `schema.ts` (+`releases` — same 0005 migration as Task 3),
  `kobox/src/domain/installation/rendering.ts` (worker unit ExecStart/WorkingDirectory →
  `/opt/kobox/current/...`), KoboxCoreInstaller (create `/opt/kobox` + `current` symlink →
  the running source tree when absent), Phase 4 goldens (unit file)
- Create: `kobox/src/application/maintenance/GitPort.ts`, `ReleaseRepositoryPort.ts`,
  `kobox/src/infrastructure/system/GitAdapter.ts`,
  `kobox/src/infrastructure/persistence/SqliteReleaseRepository.ts` (+ in-memory twin)
- Test: `kobox/test/integration/system/git.test.ts` (against a **scratch local repo** created
  by the test — never the mounted working repo), persistence integration, golden update

**Specs:**
- `releases`: id, ref, path, state `staged|current|previous|failed`, createdAt, switchedAt.
- `GitPort`: `fetch(repoDir)`, `refExists(repoDir, ref)`, `resolveRef(repoDir, ref)` (sha),
  `worktreeAdd(repoDir, path, ref)`, `worktreeRemove(repoDir, path)`, `currentRef(repoDir)`.
  Adapter is argv-only `git -C <repoDir> ...`. ⚠️ Integration tests build their own repo under
  the test tmp dir (git init + commits + tags, `file://` only — zero network, zero writes to
  the checkout that runs the tests).
- Worker unit now points at the symlink; `kobox-core` install creates
  `/opt/kobox/current -> <source tree>` only when the link is absent (idempotent; upgrade owns
  it afterwards). E2E install path stays green because the link lands before the unit starts.

**Commit:** `feat(maintenance): release ledger, argv-only GitPort and current-symlink worker layout`

## Task 9 — `kobox upgrade` / `--rollback` / `kobox migrate` (the anti-§5.6 core)

**Files:**
- Create: `kobox/src/application/maintenance/UpgradeRelease.ts`,
  `kobox/src/application/maintenance/UpgradeHostPort.ts` (build/symlink/restart seam),
  `kobox/src/infrastructure/system/UpgradeHostAdapter.ts`
- Modify: CLI (`upgrade --to <ref>`, `upgrade --rollback`, `migrate`), composition
- Test: `kobox/test/component/maintenance/upgrade-release.test.ts` (fakes, every failure
  point), `kobox/test/integration/system/upgrade.test.ts` (scratch repo → real pnpm build of a
  tiny fixture is too heavy: integration covers symlink flip atomicity + rollback with a stub
  build; the container E2E exercises the real path)

**Specs:** `UpgradeRelease.execute({ to })` — ordered, each step propagating errors:
1. `fetch` + `refExists(to)` (else fail with guidance; `--offline` skips fetch).
2. Refuse when a release with state `staged` exists (previous crash → guidance to clean).
3. `worktreeAdd(releasesDir/<sha>, to)` → record `staged`.
4. `pnpm install --frozen-lockfile` + `pnpm build` inside the staged tree (via
   `UpgradeHostPort.buildRelease(path)`, argv pnpm, exit codes propagated). Failure ⇒ worktree
   removed, row `failed`, **current untouched**.
5. DB backup (reuse `RunBackup`).
6. `migrate` with the **staged** build (`node <staged>/dist/interfaces/cli/main.js migrate` —
   new CLI command that opens the DB, runs the Drizzle migrator, exits; additive-only by
   convention documented in OPS.md).
7. Atomic flip: temp symlink + `rename(2)` over `/opt/kobox/current`
   (`UpgradeHostPort.switchCurrent(path)`); previous target recorded, rows updated
   `current`/`previous`.
8. `systemctl restart kobox-worker` + `isActive` verification (bounded retry ~10 s). Inactive ⇒
   flip back to previous, restart, report failure loudly (old version keeps running — the §5.6
   fix). Success ⇒ report `{ from, to, backup }`.
- `--rollback`: flip to the `previous` release row (must exist), restart + verify, swap row
  states. No git, no build, no migration (additive schema keeps old code runnable).
- Component tests: failure injected at every step 1-8 asserts `current` symlink and worker
  state are untouched (or restored), and the release rows tell the truth.

**Commit:** `feat(maintenance): transactional versioned upgrades with automatic rollback`

## Task 10 — pgl → ipset: render, `apply-ipset`, firewall + boot-unit wiring

**Files:**
- Create: `kobox/src/application/tracker/ApplyIpset.ts`,
  `kobox/src/application/tracker/IpsetPort.ts`, `kobox/src/infrastructure/system/IpsetAdapter.ts`,
  render in `kobox/src/domain/tracker/rendering.ts` (or sibling)
- Modify: Phase 3 firewall render (INPUT match-set rule) + its goldens,
  `renderFirewallBootUnit` (ExecStartPre ipset create/restore) + golden, worker (`apply-ipset`),
  `JobWorker.chainAfter` (blocklistsUpdated ⇒ also `apply-ipset`), IpsetInstaller
  (package `ipset`; skip with reason when `ipset create` fails — no kernel module in some
  containers), composition, CLI passthrough
- Test: unit render (golden `blocklist.ipset` with staging+swap pattern), component ApplyIpset,
  `kobox/test/integration/system/ipset.test.ts` (root+dockerenv double guard, honest skip when
  the kernel lacks ip_set), firewall goldens updated

**Specs:** rendered file: `create kobox-bl hash:net family inet maxelem 1048576 -exist` /
`create kobox-bl-next ... -exist` / `flush kobox-bl-next` / `add kobox-bl-next <cidr>` lines
from the merged blocklist cache / `swap kobox-bl kobox-bl-next` / `destroy kobox-bl-next`.
`ApplyIpset.execute()`: render (diff-only) then `ipset restore -exist -file ...`.
`apply-firewall` gains an `ensureSet` pre-step (`ipset create kobox-bl ... -exist`) so the new
INPUT rule always loads. Boot unit: `ExecStartPre=/usr/sbin/ipset create kobox-bl hash:net
family inet maxelem 1048576 -exist`, `ExecStartPre=-/usr/sbin/ipset restore -exist -file
/etc/kobox/blocklist.ipset` before the iptables-restore. Firewall INPUT rule sits right after
the trusted/loopback accepts, before service accepts.

**Commit:** `feat(tracker): kernel-level blocklist enforcement via ipset (pgl retired)`

## Task 11 — `letsencrypt` component (certbot webroot + hooks)

**Files:**
- Create: `kobox/src/application/maintenance/CertbotPort.ts`,
  `kobox/src/infrastructure/system/CertbotAdapter.ts`, LetsencryptInstaller in `installers.ts`,
  renders: ACME http-01 server block + deploy hook + cert-path switch in
  `kobox/src/domain/installation/rendering.ts`
- Modify: `renderNginxVhost` (port-80 ACME block always present; ssl_certificate paths switch
  to `/etc/letsencrypt/live/<domain>/` when the installer confirms issuance), nginx goldens,
  `SecuritySettings`/install settings (KOBOX_LE_DOMAIN, KOBOX_LE_EMAIL, KOBOX_ACME_URL,
  KOBOX_ACME_CA_BUNDLE)
- Test: goldens (hook, vhost variants), component installer test (fakes: no domain ⇒ skipped
  with guidance; domain ⇒ certbot called with exact argv; issuance failure ⇒ component failed,
  vhost stays snakeoil — guardedApply protects nginx)

**Specs:** installer: ensure `certbot` package; skip without domain/email; ensure webroot dir
`/var/www/acme` (0755); render ACME server block; `certbot certonly --webroot -w /var/www/acme
-d <domain> -m <email> --agree-tos --non-interactive [--server <acme-url>]` via port (adapter
adds `REQUESTS_CA_BUNDLE` env when `KOBOX_ACME_CA_BUNDLE` set); on success render vhost with LE
cert paths under guardedApply(nginx -t) + reload; write deploy hook (0755, golden:
`#!/bin/sh` + `systemctl reload nginx`); `systemd.enable('certbot.timer', { now: true })`.
Uninstall: remove hook, re-render snakeoil vhost; certs stay (operator data).

**Commit:** `feat(maintenance): letsencrypt component (certbot webroot, nginx hooks, native renew timer)`

## Task 12 — Container fixtures: pebble ACME + Makefile wiring

**Files:**
- Modify: `kobox/Makefile`, `kobox/docker/` (compose or run script), `kobox/docker/e2e-setup.sh`
  (hosts entry `acme.example.net`), `docs/DEV.md`

**Specs:** `make up` (or the e2e target) additionally starts `letsencrypt/pebble` (pinned tag)
on the same docker network with `PEBBLE_VA_ALWAYS_VALID=1`, directory at
`https://<pebble>:14000/dir`; the pebble minica root
(`/test/certs/pebble.minica.pem`) is copied into the kobox container and exported as
`KOBOX_ACME_CA_BUNDLE`. E2E resolves the pebble host via the docker network. No public ACME
endpoint is ever reachable from the tests (`--server` always points at the fixture).

**Commit:** `test(e2e): local pebble ACME fixture for certbot (never the real Let's Encrypt)`

## Task 13 — Phase 5 E2E: scheduler → tick → outbox → backup/restore → upgrade → letsencrypt

**Files:**
- Create: `kobox/test/e2e/maintenance-ops.e2e.test.ts`
- Modify: `docker/e2e-setup.sh` if needed

**Specs:** on the installed box (reuses the install E2E flow):
1. `install-status` shows `scheduler` installed; `/etc/cron.d/kobox` matches the golden;
   `cron.service` active.
2. **Real tick semantics:** parse `/etc/cron.d/kobox`, execute each entry's exact command line
   as root (proves the rendered commands are valid), then assert the jobs landed `pending` and
   a worker drain executes them green; running the same commands again dedupes
   (`enqueueUnique`) — queue does not grow.
3. Outbox: enqueue a mail (via a triggered notification or direct outbox insert through the
   CLI path), `kobox send-mails` + drain, assert delivery into the local Postfix loopback
   (`/var/mail/root` or mailq empty + delivered marker).
4. Backup/restore: `run-backup` → dir exists with DB + archives; mutate a row; `restore-backup`
   → row back; worker active again.
5. Upgrade: scratch clone inside the container (`file://` from the mounted tree — never
   mutating it), two tags; install layout pointed at tag A via the symlink; `kobox upgrade
   --to <tagB>` → symlink flips, worker restarts, `releases` truthful; `kobox upgrade
   --rollback` → back on A, worker active. A sabotaged build (tag with broken code) leaves A
   running.
6. letsencrypt: with pebble env set, re-run install (or the component) → cert issued, nginx
   serves it on the portal port (openssl s_client shows the pebble-issued chain), deploy hook
   present.
7. afterAll: disable cron entries added by the test (remove `/etc/cron.d/kobox`), stop any
   scratch workers, fail2ban stays off (Phase 3/4 rule), restore any flipped symlink.

**Commit:** `test(e2e): full maintenance loop on Debian 12 (tick, outbox, backup, upgrade, ACME)`

## Task 14 — Ops documentation + phase closure

**Files:**
- Create: `docs/OPS.md` (runbooks: backup/restore, upgrade/rollback + additive-migration rule,
  mail relay setup, resolv.conf → local bind switch (debt #4), ruTorrent pin process (debt #2),
  ipset decision record)
- Modify: `docs/DEV.md` (Phase 5 notes), `kobox/README` if present
- Create: `docs/PHASE-6-BRIEF.md` (Portal & Access prompt, same shape as this phase's brief)

**Specs:** OPS.md is operator-facing (English, neutral examples). PHASE-6-BRIEF.md follows the
established template: state at start, mandatory reading, locked decisions, exact scope (portal
SSR, app auth replacing Basic-Auth-only, ruTorrent iframe, per-user web creds, vendored extras
picked up, VPN CRL), guard-rails, debt list.

**Commit:** `docs: ops runbooks (backup, upgrade, relay, DNS) and Phase 6 brief`

## Task 15 — Phase gate

Full pyramid green locally (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`,
`pnpm build`, `make test-int`, `make e2e` — never piped through `tail`), then
superpowers:requesting-code-review, fixes, draft PR to `main` (<200 words, no session links),
memory updated. **No merge without owner validation** (pgl→ipset decision explicitly flagged).
