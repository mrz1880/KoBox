import { describe, expect, it } from 'vitest';
import { Announcer, InvalidAnnouncerError } from '../../../../src/domain/torrent/Announcer.js';

describe('Announcer', () => {
  it('should_parse_http_https_and_udp_announce_urls', () => {
    const https = Announcer.parse('https://tracker.example.org:2710/announce/abc123');
    expect(https.proto).toBe('https');
    expect(https.host).toBe('tracker.example.org');
    expect(https.url).toBe('https://tracker.example.org:2710/announce/abc123');

    expect(Announcer.parse('http://t.example.net/announce').proto).toBe('http');
    expect(Announcer.parse('udp://open.example.io:6969').proto).toBe('udp');
  });

  it('should_strip_credentials_and_port_from_the_host', () => {
    expect(Announcer.parse('https://user:pass@tracker.example.org:443/a').host).toBe(
      'tracker.example.org',
    );
  });

  it('should_reject_other_protocols_and_hosts_unsafe_for_a_shell', () => {
    for (const raw of [
      'ftp://tracker.example.org/announce',
      'wss://tracker.example.org/announce',
      'not a url',
      'https://track$(id)er.example/a',
      'https://;rm.example/a',
      '',
    ]) {
      expect(() => Announcer.parse(raw)).toThrow(InvalidAnnouncerError);
    }
  });
});
