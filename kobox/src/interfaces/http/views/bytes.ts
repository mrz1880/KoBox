const BYTES_PER_GIB = 1024 ** 3;
const GIB_PER_TIB = 1024;
// under this many GiB a decimal still tells the reader something
const WHOLE_GIB_FROM = 10;

// A byte count the way a person reads a disk: GiB, or TiB from 1024 GiB on.
export function formatBytes(bytes: number): string {
  const gib = bytes / BYTES_PER_GIB;
  if (gib >= GIB_PER_TIB) {
    return `${(gib / GIB_PER_TIB).toFixed(2)} TiB`;
  }
  return gib >= WHOLE_GIB_FROM || gib === 0 ? `${gib.toFixed(0)} GiB` : `${gib.toFixed(1)} GiB`;
}
