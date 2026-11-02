// The one format every stored date uses: UTC, to the second,
// 'YYYY-MM-DD HH:MM:SS'. It sorts lexicographically, so comparing two stamps
// as strings compares them in time.

export function stampOf(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// A stamp names no zone, and Date.parse would read it in the box's own: it is
// UTC, so the zone is spelled out before parsing. A malformed stamp gives NaN.
export function millisecondsOf(stamp: string): number {
  return Date.parse(`${stamp.replace(' ', 'T')}Z`);
}

export function shiftStamp(stamp: string, milliseconds: number): string {
  return stampOf(new Date(millisecondsOf(stamp) + milliseconds));
}

// The ISO instant a stamp stands for, for the code that compares instants
// rather than stored dates.
export function instantOf(stamp: string): string {
  return new Date(millisecondsOf(stamp)).toISOString();
}
