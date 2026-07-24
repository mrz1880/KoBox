import { DomainError } from '../shared/DomainError.js';

export class InvalidCertExpiryError extends DomainError {
  constructor(raw: string) {
    super(`invalid certificate expiry ${JSON.stringify(raw)}: must be a valid YYYY-MM-DD date`);
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

function isRealDate(isoDate: string): boolean {
  const ms = toUtcMs(isoDate);
  if (Number.isNaN(ms)) {
    return false;
  }
  // Date.parse accepts overflows like 2026-02-30; round-trip to reject them.
  return new Date(ms).toISOString().slice(0, 10) === isoDate;
}

export class CertExpiry {
  private constructor(readonly value: string) {}

  static on(isoDate: string): CertExpiry {
    if (!ISO_DATE_PATTERN.test(isoDate) || !isRealDate(isoDate)) {
      throw new InvalidCertExpiryError(isoDate);
    }
    return new CertExpiry(isoDate);
  }

  // The legacy stored "expiry minus 2 days" and compared to today; the margin
  // is explicit here instead of skewing the stored date.
  isDueOn(today: string, marginDays = 2): boolean {
    if (!ISO_DATE_PATTERN.test(today) || !isRealDate(today)) {
      throw new InvalidCertExpiryError(today);
    }
    return toUtcMs(today) >= toUtcMs(this.value) - marginDays * DAY_MS;
  }

  equals(other: CertExpiry): boolean {
    return this.value === other.value;
  }
}
