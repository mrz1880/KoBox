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
