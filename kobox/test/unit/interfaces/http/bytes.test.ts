import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../../../src/interfaces/http/views/bytes.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';

const GIB = 1024 ** 3;
const english = { language: Language.en, t: translatorFor(Language.en), zone: 'Europe/Paris' };
const french = { language: Language.fr, t: translatorFor(Language.fr), zone: 'Europe/Paris' };

describe('formatBytes', () => {
  it.each([
    [0, '0 GiB'],
    [1.5 * GIB, '1.5 GiB'],
    [212 * GIB, '212 GiB'],
    [2048 * GIB, '2.00 TiB'],
  ])('should_say_%d_bytes_as_%s', (bytes, said) => {
    expect(formatBytes(bytes, english)).toBe(said);
  });

  it('should_name_the_units_in_the_readers_language', () => {
    const fr = french;

    expect(formatBytes(212 * GIB, fr)).toBe('212 Gio');
    expect(formatBytes(2048 * GIB, fr)).toBe('2,00 Tio');
  });

  // a file under a gibibyte reads better in MiB than as 0.9 GiB, and a tiny one
  // as 1 MiB rather than as nothing at all
  it.each([
    [963 * 1024 ** 2, '963 MiB', '963 Mio'],
    [1024, '1 MiB', '1 Mio'],
  ])('should_say_%d_bytes_under_a_gib_in_mib', (bytes, english_, french_) => {
    expect(formatBytes(bytes, english)).toBe(english_);
    expect(formatBytes(bytes, french)).toBe(french_);
  });

  it('should_write_the_decimal_mark_the_way_a_french_reader_does', () => {
    expect(formatBytes(1.5 * GIB, french)).toBe('1,5 Gio');
  });
});
