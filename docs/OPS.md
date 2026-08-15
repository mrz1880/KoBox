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

## My media (the Cakebox successor)

Users see what landed in their completed downloads at **/media**, play what a
browser can play, and download the rest. Cakebox-light did this until upstream
archived it in 2018; this replaces it with something that has a session, CSRF
and per-user scoping, which it never had.

Three roles, deliberately separate:

- the **root worker** indexes `~user/rtorrent/complete/` into the database —
  chained after a finished torrent or a placed debrid download, plus a sweep
  every 15 min because files also leave over SFTP;
- the **portal** lists from those rows, so it keeps `ProtectHome=yes` and no
  disk access at all;
- **nginx** streams the bytes through an `internal` location, reachable only via
  a redirect the portal emits after checking the session and that the file
  belongs to that user. nginx handles range requests, so seeking works.

> **One permission is widened for this.** User homes are set to `0711` at
> creation: traversable so nginx can reach an authorised file, **not listable**,
> so nothing can enumerate a home. The completed-downloads directory itself is
> already `0755` (rtorrent needs it). Existing accounts created before this keep
> their old mode — `chmod 0711 /home/<user>` to bring them in line.

Browsers play mp4/webm/ogg; an mkv or an H.265 file is offered as a download
instead of a player that would show a black rectangle. Transcoding is out of
scope — it would be a different, far heavier project.

## Re-running `kobox install`

`kobox install` walks the **whole catalogue** every time, in dependency order,
and each component decides for itself whether there is anything to do: a marker
that already matches, a package already installed, a rendered file whose content
has not changed. Converging is the planner's job, no-oping is the installer's.

That is what makes a **re-pin land**. Point `KOBOX_NANOMON_URL` and
`KOBOX_NANOMON_SHA256` at a new release, re-run, and the component re-vendors
because its marker no longer matches. It used to skip anything already recorded
as `installed`, so the comparison inside the installer was never reached and a
re-pin did nothing at all — the registry row had to be edited by hand.

The report tells you what **this run changed**: `installed` lists the components
this pass brought up, `alreadyInstalled` the ones that were converged before it
started. A fully converged box still pays no `apt-get update`.

A failure stops the run at that component, records the reason, and exits
non-zero. Re-running walks from the top again — the components before it converge
in seconds — and arrives at the one that failed.

## Restarting a managed service

**Health → Managed services** restarts a KoBox-managed unit without a shell:
nginx, kobox-portal, kobox-aria2, kobox-nanomon, fail2ban.

The list is a **closed set** in the domain, not a free text field. An open
"restart any unit" control would be a root shell behind a nicer form — it would
reach sshd, or systemd itself. The screen is built from that same set, so the
form and the guard cannot drift apart, and the worker re-validates the name a
third time before it reaches `systemctl`.

`kobox-worker` is deliberately absent: it is the process that carries out the
restart, so restarting it from one of its own jobs would kill it mid-flight and
leave the job neither done nor failed. That one stays `systemctl restart
kobox-worker` from a shell.

Disk, CPU, memory and network are **not** duplicated here — NanoMon already
reports them at `/monitoring`.

## Reading a unit's journal

**Logs** shows the last 200 lines each KoBox unit wrote — nginx, kobox-portal,
kobox-aria2, kobox-nanomon, fail2ban and kobox-worker. Same closed-set
discipline as the restart control: `journalctl` on an arbitrary unit from a web
page would hand over the whole host's journal, including sshd and every
authentication failure on the box.

`kobox-worker` **is** here, unlike the restart list: reading a journal costs the
worker nothing, and its own log is usually the one that answers "why did that
job fail". Reading is not restarting.

An excerpt is a photograph, not a live feed. Nothing on that page refreshes on
its own, so each card states when it was captured — an excerpt from three days
ago diagnosed as if it were current is worse than no excerpt at all. The portal
never reads a journal itself: it enqueues `capture-service-log`, the root worker
runs `journalctl`, and the result lands in the database for the page to render.

Each unit keeps exactly one excerpt: a new capture replaces the previous one.
200 lines per unit per capture, archived forever, would grow the database
without anyone ever reading the older copies.

## System updates

**Updates** shows what `apt` considers upgradable, and offers two buttons —
deliberately two, never one:

- **Check for updates** — `apt-get update` then `apt list --upgradable`. Free,
  changes nothing, and also runs nightly at 05:40 (`kobox check-package-updates`,
  a scheduler entry). An admin who has to remember to click never finds out a
  security update has been waiting for a month.
- **Install them** — `apt-get upgrade -y` with `--force-confold`, non-interactive.
  This one restarts the daemons that were updated, so transfers can drop for a
  moment. It never reboots, never removes a package, and is **never scheduled**:
  an unattended upgrade restarting rtorrent at 05:40 is a different decision, and
  it belongs to whoever runs the box.

Applying re-checks immediately afterwards, so the screen reflects what is
actually installed rather than the list that was there before.

A conffile prompt would hang the worker until its timeout, so `DEBIAN_FRONTEND=
noninteractive` and `--force-confold` are not optional: KoBox keeps your existing
config files and tells you nothing was overwritten. If a package genuinely needs
a config decision, make it from a shell.

## Looking at the configuration

**Config** shows every file KoBox writes onto the box, as it is on disk right
now. Read-only — and read-only in the interface, not merely in the UI: the port
the page depends on has a `read` method and nothing else, so there is no write,
upload or delete to accidentally expose later. A screen that can edit `/etc`
from a browser is a root shell, whatever the form around it looks like.

The request carries a catalogue **id**, never a path. There is no path
concatenation anywhere in the flow, so there is no traversal to defend against:
an id that is not in the catalogue is a 400 before anything touches the disk.

The catalogue is built at load time, and the constructor refuses any path that
lives under `/etc/kobox` or `/etc/openvpn`, ends in `.env`/`.pem`/`.key`/`.crt`,
or is named `*htpasswd*`. That is deliberate: the screen's safety argument is
"no entry carries a secret", and an argument that lives only in a review comment
is one nobody enforces. Adding an entry pointing at `worker.env` does not fail
review — it fails to load.

The portal reads these files **directly**, as the unprivileged `kobox-portal`
user, with no job and no root. That only holds because every catalogued file
installs world-readable, which is a property of the installer rather than of the
reader — so the E2E asserts it on a real box: every catalogued file that exists
must be readable by `kobox-portal`, and `worker.env` and `aria2.conf` must not.

Two things are deliberately absent:

- **The SSH drop-in** (`/etc/ssh/sshd_config.d/90-kobox.conf`). It holds no
  secret, but KoBox installs it `0600`. Loosening a hardening file so a viewer
  could read it would trade real protection for convenience, and listing it
  while the read always fails would report "not on this box" for a file that is
  right there. Read that one from a shell.
- **Anything holding a secret** — `worker.env`, `portal.env`, `aria2.conf`
  (it carries the RPC secret), the debrid private key, the VPN PKI, the nginx
  htpasswd.

A file that is simply missing reads as "not on this box", which is the normal
answer when the component it belongs to was never installed — no NFS means no
exports file. Content is capped at 256 KB and says so when it truncates: the
per-user nginx map grows with the member list, and nothing should try to paint
an unbounded file into a browser.

## Sending finished downloads to a member's own machine

**Sending** (member side) has two halves: the folders, and where they go.

Each folder carries a mode — keep it here, send it a bit later, send it straight
away. A new folder starts at *keep it here*: turning on a copy to somebody
else's machine is their decision, not a default.

The destination is one per member: address, port, account, password, and a root
folder. Each folder lands in a folder of the same name over there, which is what
the legacy did and what members' NAS layouts already assume.

### What is deliberately different from MySB

- **The password is never in the clear.** MySB kept it in the member's own
  SQLite file and passed it as `sshpass -p <password>` — visible in `ps` to every
  other member of the box. KoBox seals it with the host RSA key (the same pair
  as per-member debrid keys) and hands it to `sshpass -e` through the
  environment. It never reaches an argv, and the portal cannot open one: sealing
  needs the public half, opening needs the private half, and no single process
  holds both.
- **The host key is pinned.** MySB passed both `StrictHostKeyChecking=no` and
  `UserKnownHostsFile=/dev/null`, which hands a member's own NAS credentials to
  whatever answers on that address. KoBox pins on first sight
  (`accept-new`) into `/var/lib/kobox/sync/<member>.known_hosts`, one file per
  member, and refuses — visibly, on the page — if the identity ever changes.
- **Nothing is interpolated.** Address, account and remote path are value
  objects before they can reach a command line. A host starting with a dash
  would be an ssh option rather than a host; a remote path containing `..` would
  climb out of the folder they chose. Both are refused at the boundary.

### Testing it

**Test it now** enqueues `check-sync-destination`; the root worker opens the
password, connects, and runs `test -w` on the remote folder — the smallest
question that proves the whole chain at once. The verdict is stored and shown
back in words: whether the machine answered, whether the account was accepted,
whether the folder is writable, and the fingerprint it identified itself with.

Two failures are reported separately on purpose. A password that cannot be
opened (a database restored without its host key) says *type it in again*; a
check that could not run at all (a missing binary) says *tell your admin*.
Telling a member to retype a password that is perfectly fine sends them chasing
the wrong thing.

`rsync` and `sshpass` install with the `rtorrent` component — they are what
carries a download across.

From a shell: `kobox set-sync-destination <member> <host> <port> <account>
<path>` reads the password from **stdin**, never from an argument, and
`kobox check-sync-destination <member>` runs the test.

### What actually carries a download across

A finished download in a folder set to send goes into a queue: one row per
download, `waiting -> sending -> sent` or `failed`. The queue is what the member
sees on their own page, in words rather than states — *waiting its turn*, *on
its way*, *arrived*, *did not arrive* — with the reason attached when it did not,
and a **Try again** button that puts it back in the queue.

- **One hourly pass**, `send-pending-transfers`, takes on only the members whose
  chosen hour has come. MySB wrote a cron line into every member's own crontab so
  they could pick their hour; the hour is still theirs, and nothing writes into
  anybody's crontab.
- **"Send it straight away"** does not wait for that: the finished event chains a
  pass for that member alone, deduplicated so several downloads finishing at once
  do not stack several passes over the same queue.
- **Files per pass** caps how many a single pass takes on, for a member who does
  not want one big evening to monopolise their link. 0 means everything waiting.
- **The same download is queued once.** rTorrent can fire `finished` more than
  once for one torrent; a unique index on (member, source) is what makes the
  second one a no-op rather than a duplicate transfer.
- **A path outside the member's own home is ignored.** The path arrives from a
  shim the member controls and the root worker is what reads it.

`rsync --archive --partial --append-verify` runs **once** per transfer. The
legacy looped `for ((i = 3; i >= 1; i -= 1))` with its `break` commented out, so
every file crossed the link three times on every pass. A dropped connection
resumes where it stopped rather than starting the file over, and a failure is
recorded with its reason rather than retried blindly — retry is the member's
call, on a button.

The remote folder is created before anything is copied into it: copying into a
folder that does not exist scatters files at the root of the member's NAS, which
is worse than not copying. The transfer uses `StrictHostKeyChecking=yes` against
the key pinned when they tested the connection, so an identity change between the
test and the transfer stops the transfer instead of proceeding.

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
