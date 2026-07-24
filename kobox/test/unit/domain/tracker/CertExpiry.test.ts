import { describe, expect, it } from 'vitest';
import { CertExpiry, InvalidCertExpiryError } from '../../../../src/domain/tracker/CertExpiry.js';

describe('CertExpiry', () => {
  it('should_hold_an_iso_date', () => {
    expect(CertExpiry.on('2026-09-15').value).toBe('2026-09-15');
  });

  it('should_reject_non_iso_dates', () => {
    for (const raw of ['2026-9-15', '15/09/2026', '2026-13-01', '2026-02-30', 'soon', '']) {
      expect(() => CertExpiry.on(raw)).toThrow(InvalidCertExpiryError);
    }
  });

  it('should_be_due_when_today_reaches_the_expiry_minus_margin', () => {
    const expiry = CertExpiry.on('2026-09-15');
    // default margin: 2 days (the legacy "2 days ago" skew, made explicit)
    expect(expiry.isDueOn('2026-09-12')).toBe(false);
    expect(expiry.isDueOn('2026-09-13')).toBe(true);
    expect(expiry.isDueOn('2026-09-15')).toBe(true);
    expect(expiry.isDueOn('2026-10-01')).toBe(true);
  });

  it('should_accept_a_custom_margin', () => {
    const expiry = CertExpiry.on('2026-09-15');
    expect(expiry.isDueOn('2026-09-05', 10)).toBe(true);
    expect(expiry.isDueOn('2026-09-04', 10)).toBe(false);
  });

  it('should_compare_by_value', () => {
    expect(CertExpiry.on('2026-09-15').equals(CertExpiry.on('2026-09-15'))).toBe(true);
    expect(CertExpiry.on('2026-09-15').equals(CertExpiry.on('2026-09-16'))).toBe(false);
  });
});
