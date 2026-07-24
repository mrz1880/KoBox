import { describe, expect, it } from 'vitest';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { CertExpiry } from '../../../../src/domain/tracker/CertExpiry.js';
import { Tracker } from '../../../../src/domain/tracker/Tracker.js';
import { TrackerHost } from '../../../../src/domain/tracker/TrackerHost.js';
import { InvalidPortError, TrackerPort } from '../../../../src/domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../../../src/domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../../../src/domain/tracker/TrackerProto.js';

function discoverHttps() {
  return Tracker.discover({
    host: TrackerHost.parse('tracker.example.org'),
    proto: TrackerProto.parse('https'),
    port: TrackerPort.parse(443),
    privacy: TrackerPrivacy.parse('private'),
  });
}

function discoverUdp() {
  return Tracker.discover({
    host: TrackerHost.parse('udp.example.io'),
    proto: TrackerProto.parse('udp'),
    port: TrackerPort.parse(6969),
    privacy: TrackerPrivacy.parse('public'),
  });
}

const ips = (...values: readonly string[]) => values.map((value) => IpAddress.parse(value));

describe('TrackerPort', () => {
  it('should_validate_the_port_range', () => {
    expect(TrackerPort.parse(443).value).toBe(443);
    expect(() => TrackerPort.parse(0)).toThrow(InvalidPortError);
    expect(() => TrackerPort.parse(65536)).toThrow(InvalidPortError);
  });
});

describe('Tracker', () => {
  it('should_discover_a_checkable_tracker_as_pending', () => {
    const { tracker, event } = discoverHttps();
    expect(tracker.isActive).toBe(true);
    expect(tracker.isDead).toBe(false);
    expect(tracker.isSsl).toBe(false);
    expect(tracker.checkState.value).toBe('pending');
    expect(tracker.ipv4).toEqual([]);
    expect(event).toEqual({ type: 'TrackerDiscovered', host: 'tracker.example.org' });
  });

  it('should_discover_a_udp_tracker_without_cert_check', () => {
    const { tracker } = discoverUdp();
    expect(tracker.checkState.value).toBe('none');
    expect(tracker.needsCertCheck('2026-07-24')).toBe(false);
  });

  it('should_filter_unusable_addresses_when_updating', () => {
    const { tracker } = discoverHttps();
    const updated = tracker.updateAddresses(ips('192.0.2.10', '127.0.0.1', '0.0.0.0'));
    expect(updated.ipv4.map((ip) => ip.value)).toEqual(['192.0.2.10']);
  });

  it('should_return_to_pending_when_the_address_set_changes_on_a_checkable_tracker', () => {
    const { tracker } = discoverHttps();
    const checked = tracker
      .updateAddresses(ips('192.0.2.10'))
      .beginCheck()
      .completeCheck({ promoted: false, at: '2026-07-24 10:00:00' });
    expect(checked.checkState.value).toBe('none');
    const changed = checked.updateAddresses(ips('192.0.2.11'));
    expect(changed.checkState.value).toBe('pending');
  });

  it('should_not_schedule_a_check_when_addresses_change_on_a_udp_tracker', () => {
    const { tracker } = discoverUdp();
    expect(tracker.updateAddresses(ips('192.0.2.10')).checkState.value).toBe('none');
  });

  it('should_keep_the_same_instance_when_addresses_are_unchanged', () => {
    const { tracker } = discoverHttps();
    const once = tracker.updateAddresses(ips('192.0.2.10', '192.0.2.11'));
    const twice = once.updateAddresses(ips('192.0.2.11', '192.0.2.10'));
    expect(twice).toBe(once); // order-insensitive set comparison
  });

  it('should_lock_during_check_and_promote_on_success', () => {
    const { tracker } = discoverHttps();
    const checking = tracker.beginCheck();
    expect(checking.checkState.value).toBe('checking');
    const promoted = checking.completeCheck({
      promoted: true,
      expiry: CertExpiry.on('2026-09-15'),
      at: '2026-07-24 10:00:00',
    });
    expect(promoted.isSsl).toBe(true);
    expect(promoted.proto.value).toBe('https');
    expect(promoted.port.value).toBe(443);
    expect(promoted.checkState.value).toBe('none');
    expect(promoted.certExpiry?.value).toBe('2026-09-15');
    expect(promoted.lastCheck).toBe('2026-07-24 10:00:00');
  });

  it('should_stay_plain_when_the_check_finds_no_certificate', () => {
    const { tracker } = Tracker.discover({
      host: TrackerHost.parse('plain.example.net'),
      proto: TrackerProto.parse('http'),
      port: TrackerPort.parse(80),
      privacy: TrackerPrivacy.parse('private'),
    });
    const checked = tracker.beginCheck().completeCheck({ promoted: false, at: '2026-07-24 10:00:00' });
    expect(checked.isSsl).toBe(false);
    expect(checked.proto.value).toBe('http');
    expect(checked.certExpiry).toBeUndefined();
    expect(checked.checkState.value).toBe('none');
  });

  it('should_mark_dead_once_and_deactivate', () => {
    const { tracker } = discoverHttps();
    const { tracker: dead, event } = tracker.markDead();
    expect(dead.isDead).toBe(true);
    expect(dead.isActive).toBe(false);
    expect(event).toEqual({ type: 'TrackerDied', host: 'tracker.example.org' });
    const again = dead.markDead();
    expect(again.event).toBeUndefined();
    expect(again.tracker).toBe(dead);
  });

  it('should_need_a_cert_check_when_pending_or_when_the_cert_is_due', () => {
    const { tracker } = discoverHttps();
    expect(tracker.needsCertCheck('2026-07-24')).toBe(true); // pending
    const promoted = tracker.beginCheck().completeCheck({
      promoted: true,
      expiry: CertExpiry.on('2026-09-15'),
      at: '2026-07-24 10:00:00',
    });
    expect(promoted.needsCertCheck('2026-07-24')).toBe(false);
    expect(promoted.needsCertCheck('2026-09-13')).toBe(true); // due (margin 2d)
  });

  it('should_refresh_the_port_only_while_not_promoted', () => {
    const { tracker } = discoverHttps();
    const moved = tracker.updatePort(TrackerPort.parse(2053));
    expect(moved.port.value).toBe(2053);
    const promoted = moved.beginCheck().completeCheck({
      promoted: true,
      expiry: CertExpiry.on('2026-09-15'),
      at: '2026-07-24 10:00:00',
    });
    // a later announce on another port must not downgrade the pinned TLS endpoint
    expect(promoted.updatePort(TrackerPort.parse(80))).toBe(promoted);
  });
});
