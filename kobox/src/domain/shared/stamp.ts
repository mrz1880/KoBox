// The one format every stored date uses: UTC, to the second,
// 'YYYY-MM-DD HH:MM:SS'. It sorts lexicographically, so comparing two stamps
// as strings compares them in time.

export function stampOf(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function shiftStamp(stamp: string, milliseconds: number): string {
  return stampOf(new Date(Date.parse(`${stamp.replace(' ', 'T')}Z`) + milliseconds));
}
