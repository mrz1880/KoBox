import { describe, expect, it } from 'vitest';
import { InvalidRemoteHostError, RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';

describe('RemoteHost', () => {
  it('should_accept_a_single_character_host', () => {
    expect(RemoteHost.parse('a').value).toBe('a');
  });

  it('should_accept_a_host_of_exactly_253_characters', () => {
    const longest = 'a'.repeat(253);

    expect(RemoteHost.parse(longest).value).toBe(longest);
  });

  it('should_drop_surrounding_whitespace', () => {
    expect(RemoteHost.parse('  nas.example.org \n').value).toBe('nas.example.org');
  });

  it('should_tell_why_it_refuses_a_blank_host', () => {
    expect(() => RemoteHost.parse('   ')).toThrow('invalid remote host "   ": it is empty');
  });

  it('should_tell_why_it_refuses_a_host_longer_than_253_characters', () => {
    expect(() => RemoteHost.parse('a'.repeat(254))).toThrow(/longer than a hostname can be/);
  });

  it('should_refuse_a_host_that_ends_with_a_dash_or_a_dot', () => {
    for (const raw of ['nas-', 'nas.']) {
      expect(() => RemoteHost.parse(raw), raw).toThrow(InvalidRemoteHostError);
    }
  });

  it('should_refuse_a_forbidden_character_anywhere_in_the_host', () => {
    // anchored at both ends: a valid prefix or suffix does not excuse the rest
    for (const raw of [';nas', 'nas;', 'nas_box.example.org']) {
      expect(() => RemoteHost.parse(raw), raw).toThrow(/letters, digits, dots and dashes only/);
    }
  });

  it('should_compare_by_value_and_print_as_itself', () => {
    const host = RemoteHost.parse('nas.example.org');

    expect(host.equals(RemoteHost.parse('nas.example.org'))).toBe(true);
    expect(host.equals(RemoteHost.parse('nas2.example.org'))).toBe(false);
    expect(String(host)).toBe('nas.example.org');
  });
});
