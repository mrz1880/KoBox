import type { Translate } from './messages.js';

const BYTES_PER_GIB = 1024 ** 3;
const GIB_PER_TIB = 1024;
// under this many GiB a decimal still tells the reader something
const WHOLE_GIB_FROM = 10;

// A byte count the way a person reads a disk: GiB, or TiB from 1024 GiB on,
// in the reader's own unit names.
export function formatBytes(bytes: number, t: Translate): string {
  const gib = bytes / BYTES_PER_GIB;
  if (gib >= GIB_PER_TIB) {
    return t('{amount} TiB', { amount: (gib / GIB_PER_TIB).toFixed(2) });
  }
  const amount = gib >= WHOLE_GIB_FROM || gib === 0 ? gib.toFixed(0) : gib.toFixed(1);
  return t('{amount} GiB', { amount });
}
