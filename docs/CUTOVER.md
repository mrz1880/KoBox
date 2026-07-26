# KoBox — Cutover runbook (MySB → KoBox)

> Phase 7 deliverable. How to move the live users from the legacy **MySB**
> (MariaDB + regenerated files) to **KoBox** (one SQLite store + declarative
> desired-state) **without data loss and reversibly**. Strangler, not big-bang:
> KoBox is installed *beside* MySB and only becomes reachable at the atomic nginx
> switch. Every step before that switch is read-only against prod.

> ⚠️ **NOTHING here writes to the production seedbox without an explicit GO from
> the owner.** The import dump is produced with read-only commands; the actual
> `--apply` runs against the KoBox target, not MySB. The DNS/port switch and any
> `userdel`/rollback are irreversible-class actions — confirm first.

---

## 0. Model

- **Coexistence.** MySB stays at `/opt/MySB`; KoBox installs at `/opt/kobox`.
  Both can be present at once. Only one owns the portal port `:8189` at a time,
  so the cutover is a single atomic nginx change (§7).
- **Desired-state.** The import loads **data** only. KoBox then **regenerates**
  every file (per-user `.rtorrent.rc`, nginx `/RPC-*` includes, firewall, NFS
  exports, OpenVPN profiles, tracker whitelist). We never copy a generated
  legacy file — we import the row that produces it (`docs/PROD-INSPECTION.md` §5:
  "DB survives, files die").
- **Idempotent & re-entrant.** `migrate-from-mysb` is dry-run by default and a
  re-run is a no-op for users already imported (no second account, mail or
  provisioning) and an upsert for catalogue data. A partial run is safe to
  repeat.

---

## 1. The dump contract

`migrate-from-mysb --dump <dir>` reads a **frozen dump directory**, never a live
MariaDB connection. Layout:

```
<dump>/
  mysb.sqlite          # control-plane tables mirrored from MariaDB MySB_db
  sync/<username>.sq3  # each user's ~/db/<user>.sq3, copied verbatim
```

`mysb.sqlite` must contain these tables/columns (the canonical schema is the
neutral fixture builder `kobox/test/fixtures/migration/buildDump.ts`, which
doubles as the contract):

| Table | Columns |
|---|---|
| `users` | `username, email, scgi_port, rtorrent_port, proxy_port, quota_bytes, account_type, active` |
| `trackers_list` | `host, proto, port, privacy, is_active, is_dead, is_ssl` |
| `trackers_list_ipv4` | `host, ipv4` |
| `blocklists` | `source, author, name, url, subscription, enabled` |
| `torrents` | `username, info_hash, name, label, state` |
| `user_addresses` | `username, value, kind` (`kind` ∈ `ipv4` \| `hostname`) |

`sync/<username>.sq3` only needs its original `categories(name, sync_mode)`
table — the importer reads `sync_mode` (a user counts as **sync-disabled** only
when *every* category is `0`).

### Producing the dump (read-only, on the MySB box)

MySB's real MariaDB column names differ from the contract above, so the export
is a set of **read-only `SELECT`s that alias into the contract shape**. Sketch
(run as a user with read grants; adjust column names to the live schema, which
`docs/PROD-INSPECTION.md` §3 maps):

```sh
# 1. central control plane -> a portable SQLite (single read transaction)
#    Use a SELECT ... aliasing MySB columns to the contract columns, e.g.:
#      SELECT login AS username, mail AS email, scgi_port, ... FROM users;
#      (rtorrent_port joined from users_rtorrent_cfg; proxy_port is the shared 8080)
#    Materialise each SELECT into mysb.sqlite (sqlite3 .import / a small script).
#    quota_bytes = quota_gb * 1024^3 ; account_type ∈ {normal,plex} ; active = is_active

# 2. per-user sync sqlite (already SQLite) — copy verbatim, read-only
for u in $(list-of-usernames); do
  install -Dm600 "/home/$u/db/$u.sq3" "<dump>/sync/$u.sq3"
done
```

Then copy `<dump>/` to the KoBox target. **Fixtures for tests are neutral**
(RFC 2606 / RFC 5737); a real dump carries prod identity — keep it off the repo.

---

## 2. Freeze MySB

Goal: a consistent snapshot. Put MySB into a quiet window:

- Announce the maintenance window to users.
- Stop new torrent adds / config changes (portal maintenance page, or stop the
  MySB portal vhost). Leaving `rtorrent-*` running is fine — the dump is a
  point-in-time read; late torrents just re-import cleanly on a re-run.
- (Optional) `FLUSH TABLES WITH READ LOCK` for the duration of the SELECTs, or
  use `--single-transaction`-style consistency, so `mysb.sqlite` is coherent.

If the owner wants the two dead file-patches restored before the snapshot
(`docs/PROD-INSPECTION.md` §5, user-f), re-apply them now so the dump carries
the intended `sync_mode` — the importer is faithful to whatever the dump holds.

---

## 3. Produce & review the dump — dry-run

```sh
kobox migrate-from-mysb --dump /path/to/dump            # dry-run (default)
```

The JSON report lists, per category, what **would** be created / imported and
any **conflicts** (a malformed or reserved value, a torrent/address for an
unknown user). Review it:

- `users.created` should list exactly the expected accounts, with no conflicts.
- `users.alreadyImported` is empty on a first run.
- `trackers/blocklists/torrents/addresses.imported` counts match expectations;
  `conflicts` should be empty (investigate any).

Nothing has been written yet.

---

## 4. Install KoBox on the target

On the fresh target (a clean Debian 12 box, or beside MySB):

```sh
kobox install
```

This provisions the base stack and the OpenVPN PKI, seeding an empty
`crl.pem` so `crl-verify` is satisfied (Phase 7). The root worker + portal units
are installed but the portal is **not yet** on `:8189` (see §7). Confirm
`kobox install-status` is all `installed`/`skipped`.

---

## 5. Import — `--apply`  ⟵ **owner GO required**

```sh
kobox migrate-from-mysb --dump /path/to/dump --apply
```

Per user this: creates the account on its **preserved** SCGI/rtorrent ports,
writes a temporary password (hashed for the account, **mailed** — never in the
jobs DB), sets `must_change_password`, pre-writes the torrent instance with its
`sync_disabled` flag, and enqueues provisioning. Catalogue data (trackers,
blocklists, torrents, addresses) is upserted.

---

## 6. Regenerate & smoke

Let the root worker drain (it runs continuously under systemd; or step it with
`kobox`'s worker). Then trigger the regenerations that reflect imported data and
flush the mail:

```sh
kobox send-mails            # deliver the temporary-password mails promptly (see note)
kobox render-openvpn        # per-user .ovpn profiles from the PKI
kobox renew-tracker-certs   # fetch real per-tracker certs (import left them pending)
kobox update-blocklists     # download the imported blocklist ranges, build the ipset
```

Smoke checks (per a sample user):

- `id -u <user>` exists; `/home/<user>/.rtorrent.rc` rendered; `rtorrent-<user>`
  active; SCGI/rtorrent ports match the legacy ones.
- `/etc/nginx/kobox.d/rutorrent-users.conf` contains `/RPC-<USER>`.
- Portal login with the mailed temporary password → **forced** to `/password`;
  after reset → ruTorrent frames, `.ovpn` downloads.
- `kobox doctor` is green.

> **Temporary-password window.** The mailed password is a real secret at rest in
> `mails.body` until `send-mails` flushes it, and lands in the user's inbox. Run
> `send-mails` immediately after `--apply`, and note that `must_change_password`
> forces rotation on first login regardless — the temp password is single-use.

---

## 7. Atomic switch to `:8189`

Coexistence means MySB currently owns the portal `server { listen 8189; }`. The
switch is a single nginx change:

1. Disable the MySB portal vhost (the `:8189` server block) and enable KoBox's.
2. `nginx -t && systemctl reload nginx`.

`:8189` is now served by KoBox. Because only one vhost binds the port at a time,
this is atomic — there is no dual-write window. (If DNS also points at a new
host, flip it here; keep the old A record's TTL low ahead of time.)

---

## 8. Rollback window

Keep MySB installed and its data intact for an agreed window (e.g. 1–2 weeks).
To roll back:

1. Re-enable the MySB `:8189` vhost, disable KoBox's, `nginx -t && reload`.
2. MySB's `rtorrent-*` were never stopped, so torrents keep seeding throughout —
   ports were preserved on the KoBox side precisely so the two views agree.

No destructive step (removing MySB, `userdel` on the old box) happens until the
owner declares the cutover final. Preserving legacy ports (`docs/PHASE-7-BRIEF`
§6) is what makes rollback non-disruptive: an imported user is never re-routed to
a different SCGI/rtorrent port.

---

## 9. Known drifts & post-migration toggles

- **`allow_public_tracker`** has no prod DB source (the legacy patch lived in a
  file that the regeneration erased — `docs/PROD-INSPECTION.md` §5). Import sets
  it **false** for everyone. If a user (historically user-f) needs the public-
  tracker bypass, enable it after cutover:
  `kobox set-allow-public-tracker <user> on`.
- **`sync_disabled`** is imported faithfully from `categories.sync_mode`. If the
  dump was taken before re-applying the user-f patch (§2), that user will import
  as *syncing*; toggle with `kobox set-sync-disabled <user> on`.

---

## Guardrails recap

- No write to the production seedbox without an explicit owner GO. The dump is
  read-only; `--apply` targets the KoBox box.
- Never edit a generated file to change behaviour — set the DB flag and let
  KoBox regenerate (the persistent-hooks ADR).
- Repo is public: real dumps and `HANDOFF.md` stay out of git; tests use neutral
  fixtures only.
