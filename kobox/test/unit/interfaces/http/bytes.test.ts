import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../../../src/interfaces/http/views/bytes.js';

const GIB = 1024 ** 3;

describe('formatBytes', () => {
  it.each([
    [0, '0 GiB'],
    [1.5 * GIB, '1.5 GiB'],
    [212 * GIB, '212 GiB'],
    [2048 * GIB, '2.00 TiB'],
  ])('should_say_%d_bytes_as_%s', (bytes, said) => {
    expect(formatBytes(bytes)).toBe(said);
  });
});
