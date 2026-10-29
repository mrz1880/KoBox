# KoBox cutover runbook (MySB to a new KoBox server)

How to move the members of a running **MySB** box to **KoBox** installed on a **separate, freshly
installed server**. Nothing is copied across: no downloads, no rTorrent sessions. Each member gets
a new account on the new box, and the switch-over is an address change, not an nginx switch on a
shared machine.

> **The old box is never written to.** Everything below happens on the new server. MySB keeps
> running until the owner declares the cutover final, which is what makes the rollback trivial.
> Repointing DNS, deleting accounts and decommissioning MySB are irreversible-class actions:
> confirm each one first.

---

## 0. Model

- **Two machines.** MySB stays where it is and keeps seeding. KoBox is installed, configured and
  tested on its own server, reachable under a temporary name, while members still use MySB.
- **No data carried over.** Members start with an empty rTorrent. Anything they want to keep
  seeding, they re-add on the new box (see §5).
- **Switch = address change.** On the day, the public name members use is repointed at the new
  server. Until then, both boxes answer on their own name.
- **Rollback = point the name back.** MySB was never stopped, so going back is one DNS change.
  Whatever members did on KoBox in the meantime stays on KoBox.

---

## 1. Prepare the server

- A dedicated server freshly installed with **Debian 13**, root access by SSH key.
- **Disk layout.** Only `/` has to be ext4. Members' data lives under `/home/<member>`, so put the
  large volume there. Disk quotas apply to the filesystem named by `KOBOX_QUOTA_FS`: add
  `usrquota` to its options in `/etc/fstab` and remount **before** installing. The installer never
  edits fstab; without `usrquota` it records quotas in the database and tells you what to do.
- Check the kernel against the hardware (storage controller, network card) under some load before
  going further: a box that loses its disk under the Debian 13 kernel is not a KoBox problem, and
  it is cheaper to find out now.

## 2. Install KoBox

Follow the README's install section (bootstrap script, then `kobox install`). Then:

```sh
kobox install-status   # every component installed or skipped, with a reason for each skip
kobox doctor           # green
```

Set up what the box needs before members arrive, each covered in `docs/OPS.md`:

- **Mail relay** ("Mail relay"): members receive their mails through it.
- **Let's Encrypt** ("Let's Encrypt"): request the certificate for the **temporary** name first.
  Ask again for the final name at the switch (§7).
- **Pinned components** (ruTorrent, Nextcloud, NanoMon, speedtest): unpinned means skipped.
- **Trackers and blocklists**: add the trackers members use (admin console, or
  `kobox discover-tracker <host>`), then `kobox import-blocklist-catalog`: it
  enables MySB's curated set, and the lists download right after. Until that
  import, no list exists and nothing is blocked; the admin Overview says so,
  with the button that imports it.

## 3. Create the accounts

One invitation per member: they choose their own password through the link mailed to them,
which the command also prints (valid 7 days, once).

```sh
kobox invite-member <member> --email <address> [--quota-gib <n>] [--admin]
```

Or from the admin console's Members page. Create your own admin account
first and run through §6 with it before creating the others.

## 4. Recreate each member's settings

Nothing comes over from MySB, so these are set again, per member, from what they had:

- **Folders and sending** ("Sending finished downloads to a member's own machine" in OPS): the
  destination, its folders and what each folder does with a finished download. Run
  **Test it now** before relying on it.
- **Public trackers**: a member who needs the public-tracker bypass gets
  `kobox set-allow-public-tracker <member> on`.
- **Restricted IPs and DynDNS hostnames**, if a member had them.
- **Nextcloud**: a member's account is created with their portal password, the Watch folder
  mounted in it; a member created before Nextcloud was installed gets it at their next
  password change.

## 5. What members redo on their side

Send this to members ahead of the day:

- **New password**, then change it.
- **Download clients** (Sonarr, Radarr, a script) driving rTorrent: issue an **app token** on the
  Account page and paste it where the password was (OPS, "Connecting an app"). The account
  password is not accepted there. Their remote path mapping
  (`/home/<member>/rtorrent/complete/<category>/`) keeps the same layout.
- **VPN profiles**: the new box has its own PKI, so download the `.ovpn` again. The old profile
  will not connect.
- **SSH and SFTP**: the server's host key changed. The warning their client shows is expected,
  once, after the switch.
- **Torrents to keep seeding**: re-add the `.torrent` files (ruTorrent, the watch folder or
  Nextcloud) and let rTorrent download them again; nothing is copied from MySB.

## 6. Smoke test, on the temporary name

With your own account, then with one member's:

- `id -u <member>` exists; `rtorrent-<member>` is active; `/RPC-<MEMBER>` appears in
  `/etc/nginx/kobox.d/rutorrent-users.conf`.
- Portal login, ruTorrent frames, a torrent added through each path (ruTorrent, watch folder,
  Nextcloud) reaches `complete/`.
- A finished download is sent to the member's machine.
- The `.ovpn` connects; SFTP lands in the member's chroot.
- `kobox doctor` is green.

## 7. Switch

1. Lower the TTL of the final name a day ahead, so the change propagates quickly.
2. Announce the window to members.
3. Repoint the final name at the new server.
4. Request the Let's Encrypt certificate for the final name (`KOBOX_LE_DOMAIN`, OPS
   "Let's Encrypt"), and update `KOBOX_VPN_REMOTE` if profiles should carry it.
5. Members log in on the new box and work through §5.

## 8. Rollback window and decommission

Keep MySB running and untouched for an agreed window (one to two weeks). To roll back, repoint the
name at the old server: MySB never stopped seeding, so members find it as they left it.

Nothing on MySB is removed until the owner declares the cutover final. Only then: stop its
services, and keep a backup of its database for as long as the owner wants one.

---

## Appendix: importing from MySB instead

`kobox migrate-from-mysb` can still import members from a MySB box: accounts on their **preserved**
SCGI/rTorrent ports, a temporary password **mailed** to each (never stored in the jobs DB) with a
forced reset at first login, sync folders, and the tracker, blocklist and address catalogue. It is
dry-run by default, idempotent (a re-run creates no second account or mail), and isolates failures
per member. It was built for a same-machine cutover and is not the plan above; it is kept for a box
that wants it.

### The dump contract

The importer reads a **frozen dump directory**, never a live MariaDB connection:

```
<dump>/
  mysb.sqlite          # control-plane tables mirrored from MariaDB MySB_db
  sync/<username>.sq3  # one per member: categories(name, sync_mode)
```

The canonical schema is the neutral fixture builder `kobox/test/fixtures/migration/buildDump.ts`,
which doubles as the contract:

| Table | Columns |
|---|---|
| `users` | `username, email, scgi_port, rtorrent_port, proxy_port, quota_bytes, active` |
| `trackers_list` | `host, proto, port, privacy, is_active, is_dead, is_ssl` |
| `trackers_list_ipv4` | `host, ipv4` |
| `blocklists` | `source, author, name, url, subscription, enabled` |
| `torrents` | `username, info_hash, name, label, state` |
| `user_addresses` | `username, value, kind` (`kind` is `ipv4` or `hostname`) |

Each category becomes one of the member's folders with its mode (`0` keep it here, `1` send it a
bit later, `2` send it straight away); a member is sync-disabled only when every category is `0`.
Category names keep their case, since they are also folder names on the member's machine. When no
files are carried over, leave `torrents` empty: its rows would point at downloads that are not
there.

### Producing the dump (read-only, on the MySB box)

MySB's MariaDB column names differ from the contract, so the export is a set of read-only
`SELECT`s aliasing into it, materialised into `mysb.sqlite` by a small script:

| Contract | MySB source |
|---|---|
| `users.username` / `email` | `users.users_ident` / `users.users_email` |
| `users.quota_bytes` | `users.quota * 1024` (the column is in **KB**) |
| `users.active` | `users.is_active` |
| `trackers_list.host` ... | `trackers_list.tracker`, `tracker_proto`, `tracker_port` |
| `blocklists.name` / `url` | `blocklists.list_name` / `list_url`; `enabled` = `enable` |
| `blocklists.source` | `iblocklist` when `author = 'I-Blocklist'`, else `personal` |
| `torrents.username` | `torrents.users_ident` |
| `torrents.label` | no source: leave NULL (MySB kept labels in rTorrent's session only) |
| `user_addresses.username` | join `users_addresses.id_users` to `users` |
| `sync/<user>.sq3` categories | `users_rtorrent_cfg (sub_directory, sync_mode)` |

Build `sync/<user>.sq3` from `users_rtorrent_cfg` rather than copying the member's real
`~/db/<user>.sq3`: that file also holds `ident`, whose password column nobody should read.

### Running it

```sh
kobox migrate-from-mysb --dump /path/to/dump            # dry-run: review the JSON report
kobox migrate-from-mysb --dump /path/to/dump --apply    # owner GO required
kobox send-mails                                        # flush the temporary passwords now
```

The temporary password sits in `mails.body` until `send-mails` delivers it: run it right after
`--apply`. Known findings on a real dump: an address row whose hostname holds an IPv4 literal is
reported as a conflict (fix it in MySB or accept losing it), and `http://` blocklist URLs are
upgraded to `https://` on import, since KoBox refuses http for a list that ends up in the kernel's
IP filter. Real dumps carry production identity: keep them out of the repository.
