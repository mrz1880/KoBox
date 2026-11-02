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
