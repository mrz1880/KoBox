# Sync to your own storage

Porting the MySB "Labels & synchro" screen: a finished download is pushed to the
member's own machine (a NAS, in practice), into a folder named after its label.

The legacy was read from `archive/*` — `templates/rtorrent/synchro.sh.tmpl` and
`web/pages/Synchronization.php` — rather than reconstructed from memory.

## What the legacy actually does

- One destination **per member**: method (`rsync`/`ftp`), host, port, user,
  password, remote root, "max transfers per run", "create a subdirectory for
  lone files", and the two mail subjects.
- **Categories** = rTorrent labels. Each carries a sync mode: `0` never, `1` on
  the next cron pass, `2` immediately when the download finishes. Creating a
  category creates `watch/<label>` and `complete/<label>` and restarts rTorrent.
- On finish, rTorrent runs `synchro.sh` with the label. The script reads the
  category's mode, appends a row to a `list` table, and either transfers now or
  leaves it for cron. Destination is `<remote root>/<label>/`, optionally with a
  per-file subdirectory (some scrapers need one). Lock file by PID, mail on
  success and on failure, and a "put it back in the queue" control.

That behaviour is what members use. It is ported as-is.

## What is not ported

1. **The password in the clear.** It sat in the member's own SQLite file and was
   passed as `sshpass -p <password>` — visible in `ps` to every other member of
   the box. KoBox seals it with the host RSA key (the mechanism already used for
   per-member debrid keys): the portal seals with the public half, only the root
   worker opens it, and it never reaches an argv.
2. **No host key checking at all.** The legacy passed both
   `StrictHostKeyChecking=no` and `UserKnownHostsFile=/dev/null`, which hands the
   member's own NAS credentials to whatever answers on that address. KoBox pins
   the host key on first use (`accept-new`, per-member `known_hosts`) and refuses
   — visibly, on the page — if it ever changes afterwards.
3. **SQL injection from the torrent.** The label reached
   `WHERE name = '${get_custom1}'` unquoted. KoBox parses it into a `Label`
   value object, whose charset is path- and argv-safe by construction.
4. **The three-times transfer.** `for ((i = 3; i >= 1; i -= 1))` with its `break`
   commented out: every file was rsynced three times, every pass. Retry is a
   decision about failure, not a loop body.
5. **FTP.** Dropped for v1 (owner's call, 2026-08-10). `lftp` ran with
   `ssl:verify-certificate no`, and the transport people actually use is
   rsync over SSH. If someone needs FTP, it comes back as its own decision.

Login and password stay on the page, entered from the web UI (owner's call): a
member who has to install a public key on their NAS is a member who never turns
sync on. The sealing above is what makes that acceptable.

## Slices

### Read off the live box (2026-08-15, read-only)

The deployed `synchro.sh` is **byte-identical** to the archive template — no
hidden prod patch, unlike the rTorrent hooks in Phase 1. Two things the live box
said that the archive did not:

- **Categories are capitalised**: Films, Series, Divers, Jeux, Apps, Autres,
  Audiobook. `Label` accepted lower case only, so the MySB import would have
  rejected them — and since the label also names the destination folder on the
  member's own machine, folding the case would have created a second set of
  folders beside the ones already full of their files. `Label` now preserves
  case; accents and spaces stay out, as MySB stripped those too.
- **The schedule is per member**: each member's own crontab carries their own
  `synchro.sh` line at an hour they chose. Slice 3 keeps that choice without
  writing per-user crontabs: an hourly system pass that only takes on members
  whose chosen hour has come.

## Slices

1. **A sync mode per category** — `SyncMode` on the watch dir, persisted, and
   the categories block of the page. Adding a category already exists
   (`add-watch-dir`): directories and rTorrent config are handled.
2. **The destination** (done) — `SyncDestination` aggregate, sealed password,
   the connection block, and a "test it now" that says what is wrong in words.
3. **The transfer** (done) — the queue, `rsync` over SSH from the root worker,
   the hourly pass that respects each member's chosen hour, immediate mode,
   retry, and what the member sees.
