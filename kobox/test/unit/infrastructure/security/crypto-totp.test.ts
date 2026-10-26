import { describe, expect, it } from 'vitest';
import { TotpSecret } from '../../../../src/domain/portal/TotpSecret.js';
import { CryptoTotp } from '../../../../src/infrastructure/system/CryptoTotp.js';

// RFC 6238 appendix B, SHA-1: the ASCII secret "12345678901234567890", whose
// 8-digit codes end in the 6 digits authenticator apps show
const RFC_SECRET = TotpSecret.parse('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');

describe('CryptoTotp', () => {
  it.each([
    [59, '287082', 1],
    [1111111109, '081804', 37037036],
    [1234567890, '005924', 41152263],
  ])('should_accept_the_rfc_6238_code_at_%i_seconds', (seconds, code, step) => {
    expect(new CryptoTotp().stepOf(RFC_SECRET, code, seconds * 1000)).toBe(step);
  });

  // a phone clock a little off still signs in; an old code does not
  it('should_accept_one_step_either_side_and_nothing_further', () => {
    const totp = new CryptoTotp();
    const at = 1111111109 * 1000;

    expect(totp.stepOf(RFC_SECRET, '081804', at + 30_000)).toBe(37037036);
    expect(totp.stepOf(RFC_SECRET, '081804', at + 90_000)).toBeUndefined();
    expect(totp.stepOf(RFC_SECRET, '000000', at)).toBeUndefined();
  });

  it('should_make_a_fresh_secret_each_time', () => {
    const totp = new CryptoTotp();

    expect(totp.newSecret().value).not.toBe(totp.newSecret().value);
    expect(totp.newSecret().value).toMatch(/^[A-Z2-7]{32}$/);
  });
});
