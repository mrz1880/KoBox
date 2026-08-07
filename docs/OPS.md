# KoBox — Operations runbook

Day-2 operations for an installed box. Everything here goes through the `kobox`
CLI; the root worker (`kobox-worker.service`) stays the only privileged executor.
Neutral examples throughout — substitute your own hostnames.

## The scheduler

`kobox install` renders `/etc/cron.d/kobox` (component `scheduler`). Every entry
**enqueues** a typed job (duplicate-free: a stopped worker never accumulates a
backlog); the worker executes at its own pace and a missed tick converges at the
next one.

| Schedule | Entry | Replaces (legacy) |
|---|---|---|
| `*/5` | `kobox resolve-dyndns` | DynamicAddressResolver |
| `*/5` | `kobox send-mails` | SendMails |
| `*/5` | `kobox evaluate-fair-use` | LogServerAndQuota + fair-use policing |
| `0 */6` | `kobox update-blocklists` | BlocklistsRTorrent + PeerGuardian update |
| `10 0` | `kobox renew-tracker-certs` | GetTrackersCert |
| `30 5` | `kobox run-backup` | Backup-Manager |

Gone by design: the `MySB_jobs_check` watchdog (systemd `Restart=` supervises
cron and the worker), per-user rtorrent status loops (systemd units), LetsEncrypt
renew (`certbot.timer`), and the daily self-update (**upgrades are operator-run,
see below** — auto-`git reset --hard` was the legacy's №1 ops hazard).

## Backups & restore

- `kobox run-backup` (also daily via cron): online SQLite dump (`.backup`,
  WAL-safe) + `tar.gz` of `/etc/kobox` and `/etc/letsencrypt` under
  `/var/backups/kobox/<stamp>/` (0700 root).
- Rotation: TTL 7 days, always keeping the newest 3 — a box that slept for a
  month never wipes its whole history. Tune with `KOBOX_BACKUP_TTL_DAYS`,
  `KOBOX_BACKUP_KEEP_MIN`, `KOBOX_BACKUP_ROOT`.
- **Restore**: `kobox restore-backup /var/backups/kobox/<stamp> --yes` —
  stops the worker, moves the live DB aside to `<db>.pre-restore` (never
  deleted), copies the dump in place, restarts the worker. Config archives are
  restored manually (`tar -xzf … -C /`) if needed — they rarely are, because
  every KoBox config re-renders from the DB.

## Upgrades (transactional, versioned)

```
kobox upgrade --to v1.2.0        # a git tag or commit, always pinned
kobox upgrade --rollback         # back to the previous release
```

What `--to` does, in order — any failure leaves the running release untouched:

1. `git fetch` (skip with `--offline`) and verify the ref exists.
2. Stage a **separate git worktree** under `/opt/kobox/releases/<sha>` — the
   running tree is never mutated (anti-`GitHubRepoUpdate`).
3. `pnpm install --frozen-lockfile && pnpm build` in the staged tree.
4. **Backup the DB**, then run the staged build's `kobox migrate`.
5. Flip the `/opt/kobox/current` symlink atomically and restart the worker.
   If it does not come back within ~10 s, flip back automatically and fail loudly.

The `releases` table is the ledger (`staged/current/previous/failed`). Rules:

- **Migrations must stay additive** (no dropped/renamed columns in a release
  that the previous release must still boot against): rollback keeps the
  migrated DB; the step-4 backup covers disasters.
- Never edit `/opt/kobox/current` by hand while the worker runs.
- Env knobs: `KOBOX_REPO_DIR`, `KOBOX_RELEASES_DIR`, `KOBOX_CURRENT_LINK`.

## Mail relay (outbox)

Alerts land in the `mails` table and leave via the local Postfix every 5 min
(`send-mails`), with backoff 5 m → 30 m → 2 h → 12 h and a terminal `failed`
state after 5 attempts (visible in the table, never silently dropped).

To relay through an authenticated SMTP provider:

```
printf '%s' 'the-password' | kobox configure-mail-relay \
  --host smtp.example.net --port 587 --user relay-login
```

Direct root command (no job — the secret never enters the DB): writes
`/etc/postfix/sasl_passwd` (0600) + `postmap`, sets `relayhost`/SASL/TLS via
`postconf`, reloads Postfix.

## Let's Encrypt

Set `KOBOX_LE_DOMAIN` and `KOBOX_LE_EMAIL`, then re-run `kobox install`: the
`letsencrypt` component obtains the certificate through the always-on `:80`
ACME block (webroot — no downtime) and flips the portal vhost from snakeoil to
the live chain under the `nginx -t` guard. Renewals are `certbot.timer`'s job;
the rendered deploy hook reloads nginx after each real renewal. Without a
public FQDN the component stays `skipped` and snakeoil remains.

## Blocklist enforcement (ipset — pgl retired)

pgl was never packaged for Debian 12; KoBox replaces it (decision 2026-07-25):

- `update-blocklists` chains `apply-ipset`: the merged ranges land in the
  kernel set `kobox-bl` via `/etc/kobox/blocklist.ipset` (staging set + atomic
  swap), and the firewall drops matching sources before any service accept.
  Member addresses are trusted **before** the drop — the old `allow.p2p`
  semantics, structurally.
- rtorrent-side enforcement (`ipv4_filter` per user) is independent and keeps
  working even where the kernel lacks `ip_set` (the component then reports
  `skipped`, honestly).
- After reboot, `kobox-firewall.service` recreates the set and replays the
  rendered file before restoring the rules.

## DNS: switching the box to its local resolver

`kobox install` never touches `/etc/resolv.conf` (the legacy clobbered it —
AUDIT §5.2). bind listens on 127.0.0.1 with the KoBox blacklist zones. To make
the box itself use it, opt in deliberately:

```
echo 'nameserver 127.0.0.1' > /etc/resolv.conf.kobox
# review, then switch (reversible):
cp /etc/resolv.conf /etc/resolv.conf.orig && cp /etc/resolv.conf.kobox /etc/resolv.conf
```

On DHCP/cloud images, persist through your network manager instead of the raw
file. Revert by restoring `resolv.conf.orig`.

## Pinning ruTorrent

`rutorrent` installs only from a pinned, verified artifact — there is no baked
default for a moving upstream. To (re)pin:

```
curl -fsSLo /tmp/rutorrent.tar.gz https://github.com/Novik/ruTorrent/archive/refs/tags/v5.2.11.tar.gz
sha256sum /tmp/rutorrent.tar.gz
export KOBOX_RUTORRENT_URL=https://github.com/Novik/ruTorrent/archive/refs/tags/v5.2.11.tar.gz
export KOBOX_RUTORRENT_SHA256=<the sum>
kobox install        # re-vendors when the sha differs from the installed marker
```

Upgrading ruTorrent later = the same three lines with the new tag inside a
`kobox upgrade`d release, or standalone via `kobox install`.

## Measuring the link (speedtest)

The `speedtest` component vendors `librespeed-cli` — open source, pinned and
checksum-verified like ruTorrent and NanoMon. The upstream release is a tarball
(binary + LICENSE), extracted into `/usr/local/lib/kobox-speedtest/`. Unset =
honest skip, and the admin screen says what to set:

```
# v1.0.13, linux amd64 — verified 2026-07-31
export KOBOX_SPEEDTEST_URL=https://github.com/librespeed/speedtest-cli/releases/download/v1.0.13/librespeed-cli_1.0.13_linux_amd64.tar.gz
export KOBOX_SPEEDTEST_SHA256=33f2278a6ae16e83dc80f38a16aa8689b0b315530ce30ccb6de7968a2bf7527a
kobox install
```

Re-pinning later = the same two lines with the new tag and its sum; the
component re-vendors when the sum differs from the installed marker.

Admins measure from **Health → Link speed**, or with `kobox run-speedtest`.
Results are kept as a series: a single figure says little, a drift over weeks
says the connection is degrading.

> **It saturates the link on purpose.** For its ten seconds, users' downloads
> slow down — and a measurement taken while the box is busy reads low, because
> it only sees what is left. Nothing schedules it: it runs on an explicit admin
> request, and a second click while one is running is refused rather than
> stacked. Each run also spends a few hundred MB of your provider's transfer
> allowance.

This answers "what can the link do", which is a different question from "what is
it doing" — the per-user counters and NanoMon answer that one.

## Pinning NanoMon (monitoring)

The `nanomon` component is a lightweight host monitor (CPU/RAM/disk/network +
systemd unit health), run non-root and bound to loopback; nginx proxies
`/monitoring` to it behind the portal's **admin** session. Like ruTorrent it
installs only from a pinned, verified binary — unset = honest skip. To pin:

```
# from a NanoMon release (x86_64 static musl binary + its published .sha256)
export KOBOX_NANOMON_URL=https://<nanomon-release-host>/nanomon-x86_64-unknown-linux-musl
export KOBOX_NANOMON_SHA256=<the sum>
kobox install        # re-vendors when the sha differs from the installed marker
```

Admins reach the dashboard at `https://<host>:8189/monitoring`. NanoMon's own
alerting (its `alerts.toml` → webhook) stays standalone for now.

## DDL & debrid downloads (aria2 + AllDebrid)

KoBox can turn a filehoster link (1fichier, …) into a finished file in the
user's library, the same folder Radarr/Sonarr already import from. KoBox is
**source-agnostic**: it receives a link the user already has, unlocks it through
a debrid service, downloads it, and drops it in place. It never scrapes a
source — where the links come from is the user's business.

The flow, all job-driven so the portal stays unprivileged:

```
portal /downloads  (or)  kobox request-download <user> <link> --category films|series
      → pending row + `debrid-download` job
      → worker: AllDebrid unlock → aria2 fetches the direct URL into staging
      → cron `poll-debrid-downloads` (every 2 min): on complete, the root
        worker moves the file to ~<user>/rtorrent/complete/<category>/ and
        chowns it to the user; on error, the row is marked failed
```

The `aria2` component installs the engine as a **non-root** `kobox-aria2`
account with RPC on loopback only; the RPC secret lives in
`/etc/kobox/aria2.conf` (mode 0640), never on the command line. Like ruTorrent
and NanoMon it is **skip-when-unpinned** — no secret configured, no component.

Only one server-wide secret is needed — the aria2 RPC secret:

```
export KOBOX_ARIA2_RPC_SECRET=$(openssl rand -hex 24)
kobox install        # brings up kobox-aria2.service
```

Optional: `KOBOX_DDL_STAGING` (default `/var/lib/kobox-aria2`, deliberately
outside the portal-locked `/var/lib/kobox` which `kobox-aria2` cannot traverse)
for the aria2 scratch dir; `KOBOX_ALLDEBRID_BASE_URL` overrides the API endpoint
(used by the E2E to point at a local stub).

### Debrid accounts are per-user

**Each user brings their own AllDebrid account** — there is no shared server key.
A user pastes their key on `/downloads`; it is encrypted in the browser round
trip's server leg with a public key and stored as ciphertext, and only the root
worker can open it. Admins can also set one for a user without seeing it stored
in the clear:

```
printf '%s' 'the-alldebrid-key' | kobox set-debrid-key alice
kobox clear-debrid-key alice     # drop a stored key
```

`kobox install` provisions the sealing pair, idempotently:

- `/etc/kobox/debrid-pub.pem` — `0644`, the portal seals with it
- `/etc/kobox/debrid-key.pem` — `0600 root:root`, only the worker opens with it

An existing private key is **never** regenerated (that would orphan every stored
key), and a missing public half is re-derived from it. Back up
`debrid-key.pem` with the database: restoring one without the other leaves the
stored keys undecryptable and users simply re-enter them.

Having an account is **never a prerequisite**: a user without a key just has no
DDL. Their download rows fail with "no AllDebrid account configured — add your
key in Downloads", and nothing else in KoBox is affected.

Users submit from the portal **Downloads** page (per-user, CSRF-guarded, lists
their own requests + live status) or an admin can queue one with
`kobox request-download`. Categories are the closed set `films|series`, which
picks the `complete/<category>/` subdir.

## The portal & application auth (Phase 6)

The SSR portal (`kobox-portal.service`) replaces the legacy Wolf CMS theme and
the shared nginx Basic Auth. It runs **non-root** on `127.0.0.1:8190`; nginx
(`:8189`, unchanged URL) reverse-proxies it and delegates `/ru`, `/RPC-<USER>`
and `/shell` to it via `auth_request`. The portal holds no privilege — every
mutation enqueues a typed job the root worker executes.

- **Accounts & roles**: `kobox create-user <name> --admin` grants the portal
  admin role; without `--admin` the user gets the `user` role. The credential
  (a sha512-crypt hash, the same one the system account receives) is written by
  the worker into `portal_credentials` on create-user / change-password, and
  removed on delete-user. There is no separate portal password to manage.
- **Sessions**: server-side rows (`portal_sessions`), keyed by the sha256 of an
  opaque cookie token (`kobox_session`, HttpOnly/Secure/SameSite=Lax), 7-day
  TTL, purged hourly. Suspending or deleting a user kills their live sessions.
- **Lockout & fail2ban**: 5 failed logins → 15-minute in-app lock
  (`login_attempts`); each failure logs one line to the journal under
  `SyslogIdentifier=kobox-portal`, which the `kobox-portal` fail2ban jail bans on
  (10 in 10 min).
- **Shared database**: the portal reads/writes the same SQLite as the root
  worker. `/var/lib/kobox` is `2770 root:kobox-portal` (setgid) and both units
  run `UMask=0007`, so SQLite's WAL/-shm files stay group-writable. If the portal
  logs `unable to open database file`, check those perms first.
- **Split environments (least privilege)**: the two units do NOT share an env
  file. `/etc/kobox/worker.env` (`0600 root:root`) holds the full install
  snapshot including every secret; `/etc/kobox/portal.env`
  (`0640 root:kobox-portal`) is the same snapshot **minus** the worker-only
  secrets — the debrid key, the aria2 RPC secret, the iblocklist credentials and
  the ntfy/Discord webhooks. The portal never calls those paths (it reads
  repositories and enqueues jobs), so it must not carry the secrets in its
  memory or in `/proc/<pid>/environ`, which its own uid can read. Both files are
  rendered by `kobox install`; a key is withheld from the portal when its name is
  on the explicit list **or** ends in `_SECRET`/`_TOKEN`/`_APIKEY`/`_PASSWORD`/
  `_WEBHOOK`/`_PIN` — so a secret added later is withheld by default. Adding a
  var the portal genuinely needs: just make sure it does not match that
  convention.
- **Per-user ruTorrent**: each active user gets an nginx `/RPC-<UPPERCASE>` SCGI
  mount (rendered into `/etc/nginx/kobox.d/rutorrent-users.conf`) and a matching
  `conf/users/<user>/config.php`; the render is chained after
  provision/deprovision and reloads nginx.
- **Fair-use override**: `kobox set-fair-use-override <user> --egress-bps <n|clear>
  --auth-per-hour <n|clear> --throttle-bps <n|clear>` (also from the admin
  fair-use screen) — audited, per-field (`clear` resets to the install default).

## Samba passwords

Samba uses its own password store (tdb), never the KoBox database. Set or
update one directly (the secret is read from stdin and never enters a job):

```
printf '%s' 'the-password' | kobox set-samba-password alice
```

## ShellInABox

`shellinabox` is bound to `127.0.0.1:4200` and reachable only through the
portal's admin-gated `/shell/` proxy — never exposed directly.
