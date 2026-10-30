import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../../../src/interfaces/http/views/bytes.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';

const GIB = 1024 ** 3;

describe('formatBytes', () => {
  it.each([
    [0, '0 GiB'],
    [1.5 * GIB, '1.5 GiB'],
    [212 * GIB, '212 GiB'],
    [2048 * GIB, '2.00 TiB'],
  ])('should_say_%d_bytes_as_%s', (bytes, said) => {
    expect(formatBytes(bytes, translatorFor(Language.en))).toBe(said);
  });

  it('should_name_the_units_in_the_readers_language', () => {
    const fr = translatorFor(Language.fr);

    expect(formatBytes(212 * GIB, fr)).toBe('212 Gio');
    expect(formatBytes(2048 * GIB, fr)).toBe('2.00 Tio');
  });
});
