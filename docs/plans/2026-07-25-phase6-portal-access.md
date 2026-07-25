# Phase 6 — Portal & Access Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute inline with
> superpowers:test-driven-development per task) to implement this plan task-by-task.

**Goal:** Replace the legacy Wolf CMS portal + shared Basic Auth with an SSR portal
(application auth, sessions, roles, CSRF), wire per-user ruTorrent SCGI through nginx
(`/RPC-<USER>` parity), and land the deferred vendored extras (NFS/Samba/ShellInABox).

**Architecture:** The portal is a new entrypoint `src/interfaces/http/` (Fastify, SSR pages
rendered by a tiny auto-escaping `html` tagged template — no SPA, no client build). It runs
**non-root** (`kobox-portal` system user) behind the existing nginx `:8189` vhost and holds
zero privileges: every mutation either calls an unprivileged use case or **enqueues a typed
job**; the root worker stays the only privileged executor. nginx `auth_request` delegates
`/ru` + `/RPC-*` protection to the portal session. Credentials live in a new
`portal_credentials` table (crypt sha512 hash, written by the **worker** on
create-user/change-password — same hash the system account gets); sessions/CSRF are
server-side SQLite rows.

**Tech Stack:** Fastify + @fastify/cookie + @fastify/formbody, Zod at the HTTP boundary,
Drizzle/SQLite (migration 0006), `openssl passwd -6 -salt` for verify, nginx auth_request.

---

## Locked design decisions (do not re-debate during execution)

1. **Credential store**: `portal_credentials(username UNIQUE, password_hash, role IN
   ('admin','user'), updated_at)`. The worker writes it inside `create-user` /
   `change-password` handling; `delete-user` removes credentials + sessions. `SeedboxUser`
   aggregate is untouched (role/hash are portal-context concerns, not user-provisioning ones).
2. **Login verify**: extend `PasswordHasherPort` with
   `verify(password: Password, hash: HashedPassword): Promise<boolean>` — re-hash with the
   stored salt via `openssl passwd -6 -salt <salt> -stdin`, compare with
   `crypto.timingSafeEqual`. The portal may exec openssl (unprivileged, argv-only).
3. **Sessions**: `portal_sessions(id = sha256(token) hex PK, username, csrf_token,
   created_at, expires_at)` — cookie `kobox_session` (HttpOnly, Secure, SameSite=Lax,
   Path=/), 7-day expiry. CSRF = per-session synchronizer token, hidden input on every
   form, checked on every POST.
4. **Lockout**: `login_attempts(username PK, failures, locked_until)` — 5 failures → 15 min
   lock; every failure logs `portal login failed for <user> from <ip>` (pino → journald,
   unit `SyslogIdentifier=kobox-portal`) for a new fail2ban jail.
5. **nginx**: vhost drops `auth_basic`/htpasswd; `location /` proxies to
   `127.0.0.1:8190` (env `KOBOX_PORTAL_HTTP_PORT`); `/ru/` + `/RPC-*` + `/shell/` are
   guarded by `auth_request` subrequests to portal `/internal/auth*` endpoints;
   `auth_request_set` forwards `X-Kobox-User` as `REMOTE_USER` to php-fpm so ruTorrent's
   standard multi-user layout (`conf/users/<user>/config.php`) picks the per-user profile.
6. **Per-user RPC**: rendered include `/etc/nginx/kobox.d/rutorrent-users.conf` (one
   `location = /RPC-<UPPERCASE>` per active user → `scgi_pass 127.0.0.1:<scgiPort>`) +
   per-user `conf/users/<u>/config.php`. New job `render-rutorrent-users` chained after
   `provision-rtorrent`/`deprovision-rtorrent`. RPC auth: same-user-or-admin, parsed from
   `X-Original-URI`.
7. **.ovpn download**: profiles are unreachable for chrooted users anyway; change rendered
   group from `<username>` to `kobox-portal` (0640) so the portal can stream them. The
   `kobox-portal` system user/group is created by `KoboxCoreInstaller` (identity belongs to
   core; unit/perms belong to the new `portal` component).
8. **DB sharing**: `/var/lib/kobox` → `root:kobox-portal 2770`, `kobox.db` 0660 (SQLite
   mirrors db-file perms onto -wal/-shm, so both root worker and portal can write WAL).
9. **Welcome mail**: worker enqueues an outbox mail (no password in it, ever) after
   `create-user` succeeds.
10. **Fair-use override**: new job `set-fair-use-override` → new use case
    `SetFairUseOverride` (saveOverrides + audit event).
11. **Extras**: components `nfs` (exports.d render from users×addresses, reload
    `nfs-server`, new job `render-nfs-exports`), `samba` ([homes] render guarded by
    `testparm`, passwords via direct-root `kobox set-samba-password` stdin — plaintext never
    enters DB/jobs), `shellinabox` (localhost-only, nginx `/shell/` admin-gated).
    Webmin/Seedbox-Manager/Cakebox and easy-rsa CRL: **deferred if time runs out** —
    document in OPS + next-phase brief.
12. **Screens (parity-first, sober)** — admin: dashboard/users/trackers/blocklists/
    addresses/fair-use/health(+components+releases)/mails; user: home (quota/usage/status),
    password, access (.ovpn ×3 + links), ruTorrent iframe. Reads go through repos (never
    privileged adapters); writes enqueue jobs.

---

### Task 1: deps + scaffolding
- `cd kobox && pnpm add fastify @fastify/cookie @fastify/formbody`
- Commit `chore(portal): add fastify http stack`.

### Task 2: migration 0006 + repos
- `drizzle/0006_phase6-portal-access.sql`: `portal_credentials`, `portal_sessions`,
  `login_attempts` (+ indexes). Schema in `src/infrastructure/persistence/schema.ts`.
- `SqlitePortalCredentialsRepository`, `SqlitePortalSessionRepository`,
  `SqliteLoginAttemptsRepository` + `InMemory*` fakes.
- Ports in `src/application/portal/ports.ts` (CredentialsPort, SessionStorePort,
  LoginAttemptsPort — data shapes as VOs/plain readonly types, no bare primitives across
  the domain boundary).
- Tests: `test/integration/persistence/portal*.test.ts` (real sqlite tmp file), fakes
  exercised by later component tests.

### Task 3: PasswordHasherPort.verify
- `src/domain/user/ports.ts`: add `verify`. `OpensslPasswordHasher.verify` = parse
  `$6$<salt>$` → `openssl passwd -6 -salt <salt> -stdin` → timingSafeEqual.
- Unit test with fake runner; integration test against real openssl
  (`test/integration/system/opensslPasswordHasher` extension). Update any fake hasher.

### Task 4: job contract extensions
- `create-user` payload: `role: z.enum(['admin','user']).default('user')` (additive).
- New types: `set-fair-use-override` `{username, egressLimitBps?: int|null,
  authRatePerHour?: int|null, throttleToBps?: int|null}`, `render-rutorrent-users` `{}`,
  `render-nfs-exports` `{}`.
- `buildJob` additions; CLI `create-user --admin`, `set-fair-use-override`.
- Contract snapshot update (`test/contract/jobContract.test.ts`).

### Task 5: worker side
- `JobWorker` deps + `credentials` repo + `outbox` + `now`:
  - `create-user` → save credentials (hash+role from payload) + welcome mail (email from
    payload, neutral body) ; `change-password` → update hash ; `delete-user` → delete
    credentials + sessions.
  - `set-fair-use-override` → new `SetFairUseOverride` use case (application/security):
    `fairUse.saveOverrides` + `appendEvent('override-set', …)`.
  - chains: `provision-rtorrent`/`deprovision-rtorrent` → `render-rutorrent-users`;
    `add-user-address`/`remove-user-address`/`create-user`/`delete-user` →
    `render-nfs-exports` (once nfs task lands — flag-guard until then not needed, job is
    idempotent and skips when component absent).
- Component tests with fakes/in-memory repos.

### Task 6: portal domain + application (auth core)
- `src/domain/portal/`: `Role`, `PortalSession` (expiry), `SessionToken` (opaque),
  constants (TTL 7d, lockout 5/15min).
- `src/application/portal/`: `Login` (lockout check → credentials → verify → create
  session; failure = counted + logged), `Logout`, `Authenticate` (token → session →
  user status check: suspended ⇒ reject), errors.
- Component tests (fakes): wrong password, lockout after 5, locked rejects even with good
  password, suspended user rejected, expired session rejected, happy path.

### Task 7: HTTP core (server, html, login/logout, guards, internal auth)
- `src/interfaces/http/html.ts`: auto-escaping tagged template + `raw()` + layout
  (viewport, dark/light-friendly minimal CSS inline, nav by role).
- `src/interfaces/http/server.ts`: `buildPortalServer(deps)` returning Fastify instance
  (cookie+formbody, trustProxy 127.0.0.1, no listen — testable via `.inject()`).
- Routes: `GET/POST /login`, `POST /logout`, `preHandler` auth guard + CSRF verify on all
  POST, role guard for `/admin/*`.
- `GET /internal/auth` (204 + `X-Kobox-User` | 401), `/internal/auth/rpc`
  (same-user-or-admin from `X-Original-URI` `/RPC-<U>`), `/internal/auth/admin`.
- `src/interfaces/http/main.ts` + `composition` helper `buildPortal(container)`; bin
  `kobox-portal`.
- Component tests via inject (login flow sets cookie, CSRF 403 without token, guards).
  Golden: `test/golden/portal/login.html.golden`.

### Task 8: admin users screens
- `GET /admin/users` (list + create form), `GET /admin/users/:name`,
  POSTs → enqueue `create-user` (hash via `buildJob.createUser`), `suspend-user`,
  `resume-user`, `delete-user`, `change-password` (admin reset). Flash messages via
  query param. Zod schemas per form.
- Component tests: each POST enqueues exactly the right typed job; no direct adapter use.

### Task 9: admin trackers + blocklists
- `GET /admin/trackers` (list from `trackerRepo`, actions: mark dead, renew certs),
  `GET /admin/blocklists` (list, actions: update now, import catalog, toggle? — toggle is
  repo-level: enqueue `update-blocklists` after edit; keep to existing job surface).
- Component tests.

### Task 10: admin addresses + fair-use
- `GET /admin/addresses`: userAddresses list, add/remove ipv4 + hostname forms →
  `add-user-address`/`remove-user-address`/`add-user-hostname`/`remove-user-hostname`.
- `GET /admin/fair-use`: states + last events (`fairUseRepo`), usage samples, override
  form → `set-fair-use-override`.
- Component tests.

### Task 11: admin health + mails + releases
- `GET /admin/health`: `healthProbe` results for the service set + component registry
  states + releases ledger (read-only).
- `GET /admin/mails`: `outbox.listRecent`.
- Component tests (fake probe).

### Task 12: user screens
- `GET /` role-routed home: user → my info (quota/usage/status/fair-use level), admin →
  dashboard summary (users×status×usage + pending jobs count).
- `GET/POST /password` (current + new, verify current, enqueue `change-password`).
- `GET /access`: links + `.ovpn` ×3; `GET /access/ovpn/:variant` streams
  `/etc/kobox/vpn-profiles/<me>/kobox-<variant>.ovpn` (404 if absent).
- `GET /rutorrent`: iframe page pointing at `/ru/`.
- Component tests; golden for user home.

### Task 13: nginx + ruTorrent per-user rendering
- `renderNginxVhost`: drop auth_basic; add proxy `/` → portal, `auth_request` internals,
  `/ru/` + php REMOTE_USER wiring, `include /etc/nginx/kobox.d/*.conf;`, `/shell/`
  admin-gated proxy (only when shellinabox component present? — render unconditionally,
  502 harmless, keep simple). Update goldens (both variants).
- `domain/torrent/rendering.ts`: `renderRutorrentUserConfig(user)` + collection render
  `renderRutorrentUsersInclude(users)` (nginx locations, `scgi_pass 127.0.0.1:<port>`).
- `application/torrent/RenderRutorrentUsers.ts` (deps users repo, files, reload nginx) +
  worker case. VPN profile group → `kobox-portal` in `domain/security/vpn.ts` (+ goldens).
- Golden tests for include + per-user config.php; component test for the use case.

### Task 14: portal component + systemd unit + fail2ban jail
- `renderPortalUnit()` (User/Group kobox-portal, SyslogIdentifier, EnvironmentFile
  worker.env, ExecStart node …/http/main.js, Restart=on-failure) + golden.
- `KoboxCoreInstaller`: ensure system user/group `kobox-portal`; DB dir/file perms
  (`root:kobox-portal 2770` / 0660).
- New `PortalInstaller` (`spec('portal', ['kobox-core','nginx'])`): apply unit,
  daemon-reload, enable --now; uninstall disables. `NginxInstaller`: stop creating
  htpasswd; ensure `/etc/nginx/kobox.d/` exists.
- `renderFail2banJail`: add `kobox-portal` jail (journalmatch `SyslogIdentifier=kobox-portal`,
  failregex on `portal login failed .* from <HOST>`) + golden update.
- Component tests for installers (fakes).

### Task 15: vendored extras (nfs, samba, shellinabox)
- `renderNfsExports(users, addresses)` → `/etc/exports.d/kobox.exports` + golden;
  `RenderNfsExports` use case + worker case + chains; `NfsInstaller`
  (nfs-kernel-server, enable, initial render).
- `renderSmbConf()` ([global] security=user + [homes]) + golden; `SambaInstaller` guarded
  by new `testparm` checker (ConfigCheckAdapter + fake); CLI `set-samba-password` (direct
  root, stdin → `smbpasswd -s -a`, secret never in DB/logs).
- `renderShellinaboxDefault()` (localhost-only) + golden; `ShellinaboxInstaller`.
- Catalog entries + component tests.

### Task 16: integration + E2E + docs
- Integration: portal repos vs real sqlite (done T2), openssl verify (T3), optional nginx
  `-t` check of rendered vhost in container.
- E2E `test/e2e/portal.e2e.test.ts` (container, skipIf guard): admin created via CLI
  (`--admin`), start portal child process on tmp DB/port → fetch login (cookie jar) →
  POST create user (CSRF) → drain worker → stack asserts (account, credentials row) →
  login as the user → GET /access + download .ovpn (after provision-vpn-user) →
  GET /rutorrent contains `/ru/` iframe → RPC auth endpoint 401 for wrong user →
  suspended user cannot log in. Cleanup in afterAll (delete user, kill portal).
- Docs: `docs/DEV.md` (portal dev loop, env), `docs/OPS.md` (auth model, sessions,
  fail2ban jail, samba passwords, htpasswd retirement).
- Full verification: lint + typecheck + coverage + build + `make test-int` + `make e2e`.

### Task 17: phase wrap-up
- `docs/PHASE-7-BRIEF.md`: prod migration/cutover session prompt (data migration MySQL→
  SQLite, identity dedup, coexistence plan, rollback) linked from memory.
- requesting-code-review → fixes → PR draft (<200 words, no session links).

---

Every task: red → green → refactor, `pnpm lint && pnpm typecheck && pnpm test` before its
commit (conventional commits, English, `Co-Authored-By: Claude Fable 5
<noreply@anthropic.com>`). Container suites (`make test-int`, `make e2e`) at T13+ and
before the PR.
