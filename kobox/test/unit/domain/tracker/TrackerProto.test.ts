import { describe, expect, it } from 'vitest';
import { InvalidTrackerProtoError, TrackerProto } from '../../../../src/domain/tracker/TrackerProto.js';

describe('TrackerProto', () => {
  it('should_parse_the_closed_set_of_protocols', () => {
    expect(TrackerProto.parse('http').value).toBe('http');
    expect(TrackerProto.parse('https').value).toBe('https');
    expect(TrackerProto.parse('udp').value).toBe('udp');
  });

  it('should_reject_anything_else', () => {
    for (const raw of ['ftp', 'HTTP', 'wss', '', 'http://']) {
      expect(() => TrackerProto.parse(raw)).toThrow(InvalidTrackerProtoError);
    }
  });

  it('should_expose_the_legacy_default_ports', () => {
    expect(TrackerProto.parse('http').defaultPort).toBe(80);
    expect(TrackerProto.parse('https').defaultPort).toBe(443);
    expect(TrackerProto.parse('udp').defaultPort).toBe(80);
  });

  it('should_mark_only_http_and_https_as_cert_checkable', () => {
    expect(TrackerProto.parse('http').isCheckable).toBe(true);
    expect(TrackerProto.parse('https').isCheckable).toBe(true);
    expect(TrackerProto.parse('udp').isCheckable).toBe(false);
  });
});
