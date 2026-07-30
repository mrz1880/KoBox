import { describe, expect, it } from 'vitest';
import { DebridApiKey, InvalidDebridApiKeyError } from '../../../../src/domain/ddl/DebridApiKey.js';

const RAW = 'abcdef0123456789ABCDEF';

describe('DebridApiKey', () => {
  it('should_accept_a_plausible_key_and_trim_it', () => {
    expect(DebridApiKey.parse(`  ${RAW}\n`).reveal()).toBe(RAW);
  });

  it('should_reject_what_is_obviously_not_a_key', () => {
    for (const bad of ['', 'short', 'https://alldebrid.com/apikeys', 'has spaces inside x']) {
      expect(() => DebridApiKey.parse(bad), bad).toThrow(InvalidDebridApiKeyError);
    }
  });

  it('should_stay_redacted_when_logged_or_serialized', () => {
    const key = DebridApiKey.parse(RAW);

    // the ways a secret usually escapes: string interpolation and JSON
    expect(`key=${String(key)}`).toBe('key=[redacted]');
    expect(JSON.stringify({ key })).not.toContain(RAW);
    expect(JSON.stringify([key])).toContain('[redacted]');
    // reveal() stays the single deliberate way out
    expect(key.reveal()).toBe(RAW);
  });
});
