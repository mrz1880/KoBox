import type { Reader } from './layout.js';

const BYTES_PER_MIB = 1024 ** 2;
const BYTES_PER_GIB = 1024 ** 3;
const GIB_PER_TIB = 1024;
// under this many GiB a decimal still tells the reader something
const WHOLE_GIB_FROM = 10;

// A byte count the way a person reads a disk: MiB under a GiB, GiB, or TiB
// from 1024 GiB on, in the reader's own unit names.
export function formatBytes(bytes: number, reader: Reader): string {
  if (bytes > 0 && bytes < BYTES_PER_GIB) {
    // a tiny file still exists: it reads as 1 MiB, never as 0
    const mib = Math.max(1, Math.round(bytes / BYTES_PER_MIB));
    return reader.t('{amount} MiB', { amount: decimals(mib, 0, reader) });
  }
  const gib = bytes / BYTES_PER_GIB;
  if (gib >= GIB_PER_TIB) {
    return reader.t('{amount} TiB', { amount: decimals(gib / GIB_PER_TIB, 2, reader) });
  }
  const places = gib >= WHOLE_GIB_FROM || gib === 0 ? 0 : 1;
  return reader.t('{amount} GiB', { amount: decimals(gib, places, reader) });
}

// a fixed number of places, with the reader's own decimal mark
function decimals(amount: number, places: number, reader: Reader): string {
  return amount.toLocaleString(reader.language.value, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    useGrouping: false,
  });
}
