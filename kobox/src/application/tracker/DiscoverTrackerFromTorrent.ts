import { Tracker } from '../../domain/tracker/Tracker.js';
import { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../domain/tracker/TrackerProto.js';
import type {
  CertStorePort,
  DnsResolverPort,
  TrackerNotificationPort,
  TrackerRepository,
} from '../../domain/tracker/ports.js';
import { InvalidAnnounceUrlError } from './errors.js';

export interface DiscoverTrackerCommand {
  readonly url: string;
  readonly privacy: 'public' | 'private';
  readonly today: string; // YYYY-MM-DD
}

export interface DiscoveryReport {
  readonly host?: string;
  readonly certCheckWanted: boolean;
  readonly whitelistDirty: boolean;
}

interface Deps {
  readonly trackers: TrackerRepository;
  readonly dns: DnsResolverPort;
  readonly notifications: TrackerNotificationPort;
  readonly certStore: CertStorePort;
}

interface ParsedAnnounce {
  readonly host: TrackerHost;
  readonly proto: TrackerProto;
  readonly port: TrackerPort;
}

// The typed replacement of the legacy gfnAddTracker sed/cut pipeline: an
// announce URL either parses into safe VOs or the job fails loudly.
function parseAnnounce(raw: string): ParsedAnnounce {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidAnnounceUrlError(raw, 'not a URL');
  }
  const proto = TrackerProto.parse(url.protocol.replace(':', ''));
  const host = TrackerHost.parse(url.hostname);
  const port = TrackerPort.parse(url.port === '' ? proto.defaultPort : Number(url.port));
  return { host, proto, port };
}

export class DiscoverTrackerFromTorrent {
  constructor(private readonly deps: Deps) {}

  async execute(command: DiscoverTrackerCommand): Promise<DiscoveryReport> {
    const { trackers, dns, notifications, certStore } = this.deps;
    const { host, proto, port } = parseAnnounce(command.url);

    const resolved = await dns.resolveA(host);
    const existing = await trackers.findByHost(host);

    if (resolved.length === 0) {
      if (!existing || existing.isDead) {
        // never insert (or re-flag) a host that does not resolve
        return { host: host.value, certCheckWanted: false, whitelistDirty: false };
      }
      const { tracker: dead, event } = existing.markDead();
      await trackers.save(dead);
      await certStore.remove(host);
      if (event) {
        await notifications.notify(event);
      }
      return { host: host.value, certCheckWanted: false, whitelistDirty: true };
    }

    let tracker = existing;
    if (!tracker) {
      const discovered = Tracker.discover({
        host,
        proto,
        port,
        privacy: TrackerPrivacy.parse(command.privacy),
      });
      tracker = discovered.tracker;
      await notifications.notify(discovered.event);
    }
    const updated = tracker.updatePort(port).updateAddresses(resolved);
    const dirty = existing === undefined || updated !== existing;
    if (dirty) {
      await trackers.save(updated);
    }
    return {
      host: host.value,
      certCheckWanted: !updated.isDead && updated.needsCertCheck(command.today),
      whitelistDirty: dirty,
    };
  }
}
