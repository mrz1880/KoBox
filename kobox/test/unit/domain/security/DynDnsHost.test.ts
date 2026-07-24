import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DynDnsHost,
  InvalidDynDnsHostError,
} from '../../../../src/domain/security/DynDnsHost.js';

const labelArb = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      maxLength: 10,
    }),
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  )
  .map(([first, middle, last]) => `${first}${middle}${last}`);

const validHostArb = fc
  .array(labelArb, { minLength: 2, maxLength: 4 })
  .map((labels) => labels.join('.'));

describe('DynDnsHost', () => {
  it('should_accept_valid_fqdns_and_normalize_to_lowercase', () => {
    expect(DynDnsHost.parse('dyn.example.org').value).toBe('dyn.example.org');
    expect(DynDnsHost.parse('Dyn.Example.ORG').value).toBe('dyn.example.org');
    expect(DynDnsHost.parse('user-a.dyndns.example.net').value).toBe('user-a.dyndns.example.net');
  });

  it('should_reject_ipv4_literals_a_dyndns_entry_must_be_a_name', () => {
    expect(() => DynDnsHost.parse('192.0.2.10')).toThrow(InvalidDynDnsHostError);
  });

  it('should_reject_single_label_hosts', () => {
    expect(() => DynDnsHost.parse('localhost')).toThrow(InvalidDynDnsHostError);
  });

  it('should_reject_shell_metacharacters_and_option_like_prefixes', () => {
    for (const raw of [
      '-dyn.example.org',
      'dyn.example.org;id',
      'dyn.$(id).org',
      'dyn.example.org id',
      'dyn_1.example.org',
      'dyn.example.org\n',
      '.example.org',
      'dyn..org',
      'dyn.example.org.',
      '',
    ]) {
      expect(() => DynDnsHost.parse(raw)).toThrow(InvalidDynDnsHostError);
    }
  });

  it('should_reject_hosts_longer_than_253_chars', () => {
    const long = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`;
    expect(() => DynDnsHost.parse(long)).toThrow(InvalidDynDnsHostError);
  });

  it('property_parsed_values_are_shell_safe_and_never_option_like', () => {
    fc.assert(
      fc.property(validHostArb, (raw) => {
        const host = DynDnsHost.parse(raw);
        expect(host.value).toMatch(/^[a-z0-9.-]+$/);
        expect(host.value.startsWith('-')).toBe(false);
      }),
    );
  });

  it('property_parse_is_idempotent', () => {
    fc.assert(
      fc.property(validHostArb, (raw) => {
        const once = DynDnsHost.parse(raw);
        expect(DynDnsHost.parse(once.value).value).toBe(once.value);
      }),
    );
  });

  it('should_compare_by_value', () => {
    expect(DynDnsHost.parse('a.example.org').equals(DynDnsHost.parse('A.example.org'))).toBe(true);
    expect(DynDnsHost.parse('a.example.org').equals(DynDnsHost.parse('b.example.org'))).toBe(
      false,
    );
  });
});
