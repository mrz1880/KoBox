# Space cleanup: freeing a member's quota

Validated design, 2026-11-02.

A member who fills their quota makes rTorrent fail to write, which is what used
to crash it. Nothing cleans that space today. KoBox proposes what can go, says
why, and deletes only on the member's click, or on its own once the member opted
in.

## Decisions

- A finished torrent is cleanable when either holds:
  - it has seeded enough: ratio at least R **and** finished at least D days ago.
    R and D are one box-wide rule set by an admin in Administration, default
    ratio 2 and 7 days;
  - KoBox sync already sent it to the member's machine (a `SyncTransfer` in state
    `sent` whose `source` is the torrent's `tree`).
- Never proposed: a torrent still downloading, one being sent or whose sending
  failed, files that do not come from a torrent.
- Cleaning a torrent removes it from rTorrent **and** erases its data. It cannot
  be undone, and the page says so.
- Order: the largest first, among the most seeded. The proposal stops once the
  member would be back under 80 %. The member can uncheck any line.
- Nothing is deleted without a click, unless the member turned on automatic
  cleanup in their account (off by default). Then KoBox cleans from 90 % down
  under 80 % and reports what it deleted.
- KoBox only knows what its own sync sent. A file fetched over SFTP, Nextcloud,
  NFS or imported by Sonarr is invisible to it. So automatic cleanup has a
  scope the member picks: **only what KoBox sync already sent** (the default,
  and safe) or **also what seeded enough**, with a plain warning that files
  never fetched can go. On the page, a line proposed for having seeded says
  "KoBox does not know whether you fetched it".
- An admin sees a member's usage and what is cleanable, without a delete button:
  the files are the member's.
- A member whose files are read by another machine without KoBox sync (a NAS over
  NFS, for instance) only gets the seeded criterion. KoBox has no way to know a
  file was imported elsewhere, and does not guess.

## What the member sees

- **Home, under the space gauge.** Under 80 %, a discreet link "See what can be
  cleaned". From 80 %, a highlighted box "42 GiB can be freed" with a "See and
  clean" button. With nothing cleanable, the box says so ("Nothing to clean yet:
  your torrents are still seeding").
- **`/space/cleanup`.** One line per candidate: name, size, ratio, when it
  finished, and why it is proposed ("ratio 2.4 after 12 days", "already sent to
  your machine on 28 Oct"). Boxes are checked up to the 80 % line. The portal has
  no client JavaScript, so the freed total is recomputed on reload. A sentence
  above the button says the files will be erased from the seedbox; the button
  reads "Delete for good (N GiB)". The snapshot date is shown.
- **After the click** the worker deletes, as for every action, and the page
  confirms what went. The gauge is measured again right away instead of waiting
  for the hourly sample.
- **Mail at 90 %**, to the member, never to admins. Once per climb: it is sent
  again only after the member went back under 80 % and climbed again. It gives the
  usage, what can be freed and the link. With nothing cleanable it says so and
  suggests deleting by hand or asking for more quota.
- **Automatic cleanup**, a setting in My account: off, on for what KoBox sent,
  or on for what KoBox sent and what seeded enough. When it runs, the member gets
  one mail listing what was deleted and the space it gave back, and the home page
  shows the same report.

## Model

Domain types, all pure:

- `SeedRule`: minimum ratio and minimum days since the download finished,
  validated on construction (ratio above 0, at least one day).
- `CleanupCandidate`: a finished torrent with its size, ratio, finish date and
  reason (`seeded` or `alreadySent`).
- `CleanupProposal`: the collection owning the set rule. It orders candidates,
  checks them up to the 80 % line and totals the space freed.
- `QuotaPressure`: from usage and quota, says whether the member is under 80 %,
  between 80 and 90 %, or past 90 %. The two thresholds are named here and only
  here. It decides the home box, the mail and the automatic run.

## Flow

1. **Hourly sample.** `SampleDiskUsage` already measures every member. It now
   also reads each member's torrents over their SCGI (ratio, size, finish date),
   crosses them with sent transfers and stores a snapshot of candidates. The
   portal runs non-root and cannot talk to another account's SCGI, so it reads
   the snapshot; the page stays instant.
2. **Pressure.** On crossing 90 %, the sample (`WatchMemberSpace`) puts the
   mail straight in the outbox, which already retries it, so no job type is
   needed for it. With automatic cleanup on and a snapshot younger than two
   hours, it queues `clean-up-space` instead, on the lines a proposal built
   from the candidates the member's scope allows would check. Either one sets
   the once-per-climb marker kept with the member's space preferences, so a
   cleanup that leaves the member past 90 % does not run again every hour.
3. **Cleanup job.** `CleanUpSpace` takes a list of torrents. Before each deletion
   the worker checks the torrent live against the rule. One that no longer
   qualifies (restarted, being sent) is skipped and the report says why. A
   deletion removes the torrent from rTorrent first, then erases its data.

`RtorrentControlPort` gains a read of a member's torrents and an erase. Erasing
the data goes through its own port.

## Storage

- The seed rule in the admin settings.
- On the member: the automatic cleanup scope (off, sent only, sent or seeded)
  and the "90 % mail sent" marker.
- A table holding the latest candidate snapshot per member, with its date.

## Errors

- **A member's rTorrent does not answer during the sample.** The previous
  snapshot stays, with its date shown. No automatic cleanup runs on a snapshot
  older than two hours.
- **A torrent changed between the snapshot and the click.** The live recheck
  skips it, and the report says why.
- **Partial deletion** (removed from rTorrent, erasing the folder failed). The
  member is told, the failure is logged, the orphan folder stays visible in
  Files. No silent retry on data.
- **A path outside the member's space.** Refused in the domain: only paths under
  the member's download folder are erased, never through a symbolic link.
- **Automatic cleanup finds nothing.** The member gets the ordinary 90 % mail,
  which says nothing is cleanable, so they do not believe they are covered.

## Tests

- **Domain, most of them.** `SeedRule` validation; `QuotaPressure` at 79, 80, 89
  and 90 %; `CleanupProposal` ordering, stop at 80 %, exclusions (downloading,
  being sent, failed sending); the once-per-climb mail.
- **Use cases with fakes.** The sample queues the mail or the cleanup; the live
  recheck skips a torrent that stopped qualifying; automatic cleanup refuses a
  stale snapshot.
- **Adapters.** SCGI read and erase against the real rtorrent of the E2E setup;
  erasing in a temporary folder that holds a symbolic link trap; the Drizzle
  migration.
- **Portal.** The page, the box at 80 %, the golden render.
- **E2E.** One path, from a seeded torrent to the space given back.

## Addendum, 2026-11-02: a member's own seed rule

Members seed on different trackers, and their accounts carry the risk. One
member deletes after two weeks whatever the ratio.

- The admin's rule becomes the box default. Nothing changes for a member who
  keeps it.
- In My account a member keeps the box rule or sets their own: a minimum number
  of days since the download finished (required, at least one), and a minimum
  ratio that may be left empty, in which case only the days count.
- The member's rule applies everywhere for them: their list, their manual
  cleanup, their automatic cleanup, and the live recheck before deleting.
- The page words the reason after the rule that applied ("finished 16 days
  ago, your rule: 14 days" when only the days count).
- The admin's members list shows who set their own rule.
- No floor set by the admin: a low ratio can cost a member a private tracker
  account, but it is their account, and they can already delete by hand.
- "Already sent" is unchanged.

## Addendum, 2026-11-10: when automatic cleanup runs

The member who deletes after two weeks kept torrents of 15 days: their space
was at half its allowance, and automatic cleanup only ran past 90 %. The rule
said what may go; nothing said it should go before the space ran short.

- Automatic cleanup gains a second choice beside what it may delete: when.
  "Once my space passes 90 %" stays the default and behaves as before. "As
  soon as a torrent meets my cleanup rule" deletes, at every hourly pass,
  everything the first choice covers, whatever space is left.
- Past the line, a member whose rule already cleans is not cleaned for twice
  nor mailed: what their rule allowed is already on its way out.
- That cleanup is tried again every hour, so one that deleted nothing is
  neither mailed nor kept: it would hide what the last one deleted. The mail of
  one that deleted speaks of the rule, not of the 90 %.
- The home shows the latest of what KoBox deleted on its own, either way.
