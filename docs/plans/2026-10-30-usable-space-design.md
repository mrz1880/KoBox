# Usable space per member: design

Validated with the owner on 2026-10-30.

## Goal

A member sees, on their home page, how much space they can still fill. An admin
sees the same figure for every member, plus the state of the whole disk.

## Rule

Usable space is the smaller of:

- the member's allowance minus what they use, never below zero;
- the free space left on the volume that holds `/home`.

The quotas can add up to more than the disk (today 8 x 400 GiB = 3.2 TiB on a
3.4 TB disk), so the allowance alone can promise space that is not there. The
rule lives in the domain as `UsableSpace`, which also says which of the two
limits binds, so a page can tell the member that the disk, not their quota, is
the limit.

## Measurement

The hourly `sample-disk-usage` job already records each member's usage (root
only, `quota(1)`). It also records, once per pass, the free and total size of
the `/home` volume (`statfs`), in a new one-row table, through an additive
migration. The portal runs non-root and only reads the database, as today.
Usable space is computed at render time from the latest samples. Before the
first sample, pages say the space has not been measured yet instead of
guessing.

## Display

- Member home: one plain sentence, no gauge. "212 GiB free of your 400 GiB
  (188 GiB used), measured at 19:00". When the disk binds: the free figure and a
  sentence saying the box's disk is nearly full, so the allowance can no longer
  be reached. Before any sample: "Space not measured yet."
- Admin members list: Used and Free columns next to the allowance; a member
  limited by the disk is marked so in the Free column. Above the table, one line
  for the box: disk free of disk size, and the total of all allowances, so
  overcommitment is visible.
- Admin member page: the existing "using X of Y" sentence gains the usable
  space, from the same rule.
- Every new sentence has its French line.

## Testing

- Unit: `UsableSpace` with the allowance binding, the disk binding, and a
  member already over their allowance (zero, never negative).
- Integration: the `statfs` reading and the new table.
- Component: both pages, in French, and the not-measured-yet case.

## Cleanups in bounds

- The `SignalRow` comment in `userPages.ts` still says disk usage cannot be
  known by the portal; samples have made that false.
- `Quota.maxSettable` is used only by its own tests; remove it unless the new
  rule needs it.
