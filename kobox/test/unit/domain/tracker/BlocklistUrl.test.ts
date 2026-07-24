import { describe, expect, it } from 'vitest';
import {
  BlocklistUrl,
  InvalidBlocklistUrlError,
} from '../../../../src/domain/tracker/BlocklistUrl.js';

describe('BlocklistUrl', () => {
  it('should_accept_https_urls_only', () => {
    const url = BlocklistUrl.parse('https://list.example.org/?list=abc&fileformat=p2p');
    expect(url.value).toBe('https://list.example.org/?list=abc&fileformat=p2p');
  });

  it('should_reject_plain_http_and_other_schemes', () => {
    // §5.6 fix: unverified transports are unrepresentable
    for (const raw of [
      'http://list.example.org/?list=abc',
      'ftp://list.example.org/x',
      'file:///etc/passwd',
      'not a url',
      '',
    ]) {
      expect(() => BlocklistUrl.parse(raw)).toThrow(InvalidBlocklistUrlError);
    }
  });

  it('should_reject_hosts_with_unsafe_characters', () => {
    expect(() => BlocklistUrl.parse('https://li$t.example.org/x')).toThrow(
      InvalidBlocklistUrlError,
    );
  });

  it('should_append_subscription_credentials_without_mutating_the_value', () => {
    const url = BlocklistUrl.parse('https://list.example.org/?list=abc&fileformat=p2p');
    const withCreds = url.withCredentials('alice', 's3cret');
    expect(withCreds).toBe(
      'https://list.example.org/?list=abc&fileformat=p2p&username=alice&pin=s3cret',
    );
    expect(url.value).toBe('https://list.example.org/?list=abc&fileformat=p2p');
  });
});
