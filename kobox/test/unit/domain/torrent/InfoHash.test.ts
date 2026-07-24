import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InfoHash, InvalidInfoHashError } from '../../../../src/domain/torrent/InfoHash.js';

const hexCharArb = fc.constantFrom(...'0123456789abcdefABCDEF'.split(''));
const validHashArb = fc
  .array(hexCharArb, { minLength: 40, maxLength: 40 })
  .map((chars) => chars.join(''));

describe('InfoHash', () => {
  it('should_accept_any_40_hex_chars_and_normalize_to_uppercase', () => {
    fc.assert(
      fc.property(validHashArb, (raw) => {
        expect(InfoHash.parse(raw).value).toBe(raw.toUpperCase());
      }),
    );
  });

  it('should_reject_wrong_lengths', () => {
    fc.assert(
      fc.property(
        fc.array(hexCharArb, { maxLength: 80 }).filter((chars) => chars.length !== 40),
        (chars) => {
          expect(() => InfoHash.parse(chars.join(''))).toThrow(InvalidInfoHashError);
        },
      ),
    );
  });

  it('should_reject_non_hex_characters', () => {
    for (const raw of ['g'.repeat(40), `${'a'.repeat(39)};`, `${'a'.repeat(39)} `, '']) {
      expect(() => InfoHash.parse(raw)).toThrow(InvalidInfoHashError);
    }
  });

  it('should_compare_by_normalized_value', () => {
    const lower = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');
    const upper = InfoHash.parse('A1B2C3D4E5F6A7B8C9D0A1B2C3D4E5F6A7B8C9D0');
    expect(lower.equals(upper)).toBe(true);
  });
});
