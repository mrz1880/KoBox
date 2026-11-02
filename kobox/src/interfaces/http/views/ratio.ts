import type { Reader } from './layout.js';

// A ratio to one decimal, or two when the second one says something, with the
// reader's own decimal mark.
export function formatRatio(ratio: number, reader: Reader): string {
  return ratio.toLocaleString(reader.language.value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

// A bound a ratio may take, as the reader would write it: "100", not "100.0",
// since a limit is a round figure rather than a measured ratio.
export function formatRatioBound(bound: number, reader: Reader): string {
  return bound.toLocaleString(reader.language.value, {
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}
