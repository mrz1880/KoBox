// Ratios are stored as integer thousandths, so a ratio read back compares
// exactly with the one saved: 2.45 is kept as 2450, never as a float that
// SQLite may round differently.
const THOUSANDTHS = 1000;

export function toRatioMilli(ratio: number): number {
  return Math.round(ratio * THOUSANDTHS);
}

export function fromRatioMilli(ratioMilli: number): number {
  return ratioMilli / THOUSANDTHS;
}
