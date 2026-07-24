import { IpAddress } from '../../src/domain/shared/IpAddress.js';
import { CertExpiry } from '../../src/domain/tracker/CertExpiry.js';
import { Tracker } from '../../src/domain/tracker/Tracker.js';
import { TrackerHost } from '../../src/domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../src/domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../src/domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../src/domain/tracker/TrackerProto.js';

export class TrackerBuilder {
  private host = 'tracker.example.org';
  private proto: 'http' | 'https' | 'udp' = 'https';
  private port = 443;
  private readonly privacy: 'public' | 'private' = 'private';
  private ips: readonly string[] = [];
  private promotedExpiry: string | undefined;
  private dead = false;

  withHost(host: string): this {
    this.host = host;
    return this;
  }

  withProto(proto: 'http' | 'https' | 'udp', port: number): this {
    this.proto = proto;
    this.port = port;
    return this;
  }

  withAddresses(...ips: readonly string[]): this {
    this.ips = ips;
    return this;
  }

  promotedUntil(expiry: string): this {
    this.promotedExpiry = expiry;
    return this;
  }

  deadTracker(): this {
    this.dead = true;
    return this;
  }

  build(): Tracker {
    let tracker = Tracker.discover({
      host: TrackerHost.parse(this.host),
      proto: TrackerProto.parse(this.proto),
      port: TrackerPort.parse(this.port),
      privacy: TrackerPrivacy.parse(this.privacy),
    }).tracker;
    if (this.ips.length > 0) {
      tracker = tracker.updateAddresses(this.ips.map((ip) => IpAddress.parse(ip)));
    }
    if (this.promotedExpiry !== undefined) {
      tracker = tracker.beginCheck().completeCheck({
        promoted: true,
        expiry: CertExpiry.on(this.promotedExpiry),
        at: '2026-07-01 00:00:00',
      });
    }
    if (this.dead) {
      tracker = tracker.markDead().tracker;
    }
    return tracker;
  }
}

export function aTracker(): TrackerBuilder {
  return new TrackerBuilder();
}
