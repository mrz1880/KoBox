// Backup naming and TTL rotation (Backup-Manager parity, AUDIT §1.7) as pure
// decisions: infrastructure lists directories and deletes what this returns.

const STAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const DAY_MS = 86_400_000;

export interface BackupRotationOptions {
  readonly ttlDays: number;
  readonly keepMin: number;
}

export function backupStamp(now: string): string {
  return `${now.replace(/[-:]/g, '').replace(' ', 'T')}Z`;
}

function parseStamp(stamp: string): number | undefined {
  const m = STAMP_PATTERN.exec(stamp);
  if (!m) {
    return undefined;
  }
  const ms = Date.parse(
    `${m[1] ?? ''}-${m[2] ?? ''}-${m[3] ?? ''}T${m[4] ?? ''}:${m[5] ?? ''}:${m[6] ?? ''}Z`,
  );
  return Number.isNaN(ms) ? undefined : ms;
}

// Deletes only what is BOTH older than the TTL and beyond the newest keepMin
// survivors — a box that slept for a month keeps its history instead of
// wiping it on the first tick back (anti-§5.2 destructive regeneration).
export function planBackupRotation(
  stamps: readonly string[],
  now: string,
  options: BackupRotationOptions,
): readonly string[] {
  const nowMs = Date.parse(`${now.replace(' ', 'T')}Z`);
  const dated = stamps
    .map((stamp) => ({ stamp, ms: parseStamp(stamp) }))
    .filter((entry): entry is { stamp: string; ms: number } => entry.ms !== undefined)
    .sort((a, b) => b.ms - a.ms);
  return dated
    .slice(options.keepMin)
    .filter((entry) => nowMs - entry.ms > options.ttlDays * DAY_MS)
    .map((entry) => entry.stamp)
    .sort();
}
