import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidTrackerHostError, TrackerHost } from '../../../../src/domain/tracker/TrackerHost.js';

const labelArb = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
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

describe('TrackerHost', () => {
  it('should_accept_valid_fqdns_and_normalize_to_lowercase', () => {
    expect(TrackerHost.parse('tracker.example.org').value).toBe('tracker.example.org');
    expect(TrackerHost.parse('Tracker.Example.ORG').value).toBe('tracker.example.org');
    expect(TrackerHost.parse('a-1.b2.example.io').value).toBe('a-1.b2.example.io');
  });

  it('should_accept_ipv4_literals_as_host', () => {
    expect(TrackerHost.parse('192.0.2.10').value).toBe('192.0.2.10');
  });

  it('should_expose_the_registrable_domain', () => {
    expect(TrackerHost.parse('announce.tracker.example.org').registrableDomain).toBe('example.org');
    expect(TrackerHost.parse('example.org').registrableDomain).toBe('example.org');
    expect(TrackerHost.parse('192.0.2.10').registrableDomain).toBe('192.0.2.10');
  });

  it('should_reject_single_label_hosts', () => {
    expect(() => TrackerHost.parse('localhost')).toThrow(InvalidTrackerHostError);
  });

  it('should_reject_shell_metacharacters_and_option_like_prefixes', () => {
    for (const raw of [
      '-tracker.example.org', // could be read as an openssl option
      'tracker.example.org;id',
      'tracker.$(id).org',
      'tracker.example.org id',
      'tracker_1.example.org',
      'tracker.example.org\n',
      "tracker.'ex'.org",
      '.example.org',
      'tracker..org',
      'tracker.example.org.',
      'tracker.-bad.org',
      'bad-.example.org',
      '',
    ]) {
      expect(() => TrackerHost.parse(raw)).toThrow(InvalidTrackerHostError);
    }
  });

  it('should_reject_hosts_longer_than_253_chars', () => {
    const long = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`;
    expect(long.length).toBeGreaterThan(253);
    expect(() => TrackerHost.parse(long)).toThrow(InvalidTrackerHostError);
  });

  it('should_reject_labels_longer_than_63_chars', () => {
    expect(() => TrackerHost.parse(`${'a'.repeat(64)}.org`)).toThrow(InvalidTrackerHostError);
  });

  it('property_parsed_values_are_shell_safe_and_never_option_like', () => {
    fc.assert(
      fc.property(validHostArb, (raw) => {
        const host = TrackerHost.parse(raw);
        expect(host.value).toMatch(/^[a-z0-9.-]+$/);
        expect(host.value.startsWith('-')).toBe(false);
      }),
    );
  });

  it('property_strings_with_characters_outside_the_charset_always_throw', () => {
    const unsafeCharArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((raw) => !/^[A-Za-z0-9.-]*$/.test(raw));
    fc.assert(
      fc.property(unsafeCharArb, (raw) => {
        expect(() => TrackerHost.parse(raw)).toThrow(InvalidTrackerHostError);
      }),
    );
  });

  it('property_parse_is_idempotent', () => {
    fc.assert(
      fc.property(validHostArb, (raw) => {
        const once = TrackerHost.parse(raw);
        expect(TrackerHost.parse(once.value).value).toBe(once.value);
      }),
    );
  });

  it('should_compare_by_value', () => {
    expect(TrackerHost.parse('a.example.org').equals(TrackerHost.parse('A.example.org'))).toBe(
      true,
    );
    expect(TrackerHost.parse('a.example.org').equals(TrackerHost.parse('b.example.org'))).toBe(
      false,
    );
  });
});
