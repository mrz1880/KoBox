import type { Reader } from './layout.js';

// Stamps are written in UTC (see stampOf); a reader expects the box's own
// clock, in their own words.
export function formatMoment(stamp: string, reader: Reader): string {
  return new Date(`${stamp.replace(' ', 'T')}Z`).toLocaleString(reader.language.value, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: reader.zone,
  });
}
