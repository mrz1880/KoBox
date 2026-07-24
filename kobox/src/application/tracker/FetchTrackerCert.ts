import { CertExpiry } from '../../domain/tracker/CertExpiry.js';
import type { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import type {
  CertStorePort,
  TrackerCertPort,
  TrackerNotificationPort,
  TrackerRepository,
} from '../../domain/tracker/ports.js';
import { TrackerNotFoundError } from './errors.js';

export interface FetchTrackerCertCommand {
  readonly host: TrackerHost;
  readonly now: string; // YYYY-MM-DD HH:MM:SS
}

export interface CertCheckReport {
  readonly promoted: boolean;
  readonly whitelistDirty: boolean;
}

interface Deps {
  readonly trackers: TrackerRepository;
  readonly certPort: TrackerCertPort;
  readonly certStore: CertStorePort;
  readonly notifications: TrackerNotificationPort;
}

// The signature feature, worker-side: probe the tracker over TLS, install the
// cert, promote the endpoint. The check lock is persisted (visible in the DB,
// like the legacy to_check=3) and always released — even on a hard failure.
export class FetchTrackerCert {
  constructor(private readonly deps: Deps) {}

  async execute(command: FetchTrackerCertCommand): Promise<CertCheckReport> {
    const { trackers, certPort, certStore, notifications } = this.deps;
    const tracker = await trackers.findByHost(command.host);
    if (!tracker) {
      throw new TrackerNotFoundError(command.host.value);
    }
    if (tracker.isDead) {
      return { promoted: false, whitelistDirty: false };
    }

    const locked = tracker.beginCheck();
    await trackers.save(locked);

    try {
      const fetched = await certPort.fetch(tracker.host, tracker.port);

      if (!fetched) {
        // Promoted tracker: transient failure — defer, keep the cert state.
        // Never-promoted tracker: a plain-http endpoint, settle as such.
        const next = tracker.isSsl
          ? locked.deferCheck(command.now)
          : locked.completeCheck({ promoted: false, at: command.now });
        await trackers.save(next);
        return { promoted: false, whitelistDirty: false };
      }

      await certStore.install(tracker.host, fetched.pem);
      await certStore.rehash();
      const expiry = CertExpiry.on(fetched.expiresOn);
      await trackers.save(locked.completeCheck({ promoted: true, expiry, at: command.now }));

      const previous = tracker.certExpiry;
      if (previous !== undefined && !previous.equals(expiry)) {
        await notifications.notify({
          type: 'TrackerCertRenewed',
          host: tracker.host.value,
          expiresOn: expiry.value,
        });
      }
      return { promoted: true, whitelistDirty: true };
    } catch (error) {
      // Release the lock whatever failed (fetch, store, save): a tracker must
      // never stay stuck in 'checking'. Best-effort — if even this save
      // fails, needsCertCheck still reselects 'checking' rows (self-heal).
      await trackers.save(tracker).catch(() => undefined);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
