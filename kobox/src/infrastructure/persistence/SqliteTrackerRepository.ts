import { eq } from 'drizzle-orm';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import { CertExpiry } from '../../domain/tracker/CertExpiry.js';
import { CheckState } from '../../domain/tracker/CheckState.js';
import { Tracker } from '../../domain/tracker/Tracker.js';
import { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../domain/tracker/TrackerProto.js';
import type { TrackerRepository } from '../../domain/tracker/ports.js';
import type { KoboxDatabase } from './db.js';
import { trackerIpv4, trackers } from './schema.js';

type TrackerRow = typeof trackers.$inferSelect;

export class SqliteTrackerRepository implements TrackerRepository {
  constructor(private readonly db: KoboxDatabase) {}

  findByHost(host: TrackerHost): Promise<Tracker | undefined> {
    const row = this.db.orm.select().from(trackers).where(eq(trackers.host, host.value)).get();
    return Promise.resolve(row ? this.restore(row) : undefined);
  }

  listAll(): Promise<readonly Tracker[]> {
    const rows = this.db.orm.select().from(trackers).all();
    return Promise.resolve(rows.map((row) => this.restore(row)));
  }

  // ~46 trackers in prod: load-all keeps the due-check rule in the domain
  // (Tracker.needsCertCheck) instead of duplicating it in SQL.
  async listNeedingCertCheck(today: string): Promise<readonly Tracker[]> {
    const all = await this.listAll();
    return all.filter((tracker) => !tracker.isDead && tracker.needsCertCheck(today));
  }

  save(tracker: Tracker): Promise<Tracker> {
    this.db.orm.transaction((tx) => {
      const values = {
        host: tracker.host.value,
        domain: tracker.host.registrableDomain,
        proto: tracker.proto.value,
        port: tracker.port.value,
        privacy: tracker.privacy.value,
        isActive: tracker.isActive ? 1 : 0,
        isDead: tracker.isDead ? 1 : 0,
        isSsl: tracker.isSsl ? 1 : 0,
        checkState: tracker.checkState.value,
        certExpiration: tracker.certExpiry?.value ?? null,
        lastCheck: tracker.lastCheck ?? null,
      };
      const saved = tx
        .insert(trackers)
        .values(values)
        .onConflictDoUpdate({ target: trackers.host, set: values })
        .returning({ id: trackers.id })
        .get();
      // addresses are value objects of the aggregate: replace wholesale
      tx.delete(trackerIpv4).where(eq(trackerIpv4.trackerId, saved.id)).run();
      if (tracker.ipv4.length > 0) {
        tx.insert(trackerIpv4)
          .values(tracker.ipv4.map((ip) => ({ trackerId: saved.id, ipv4: ip.value })))
          .run();
      }
    });
    return Promise.resolve(tracker);
  }

  private restore(row: TrackerRow): Tracker {
    const ips = this.db.orm
      .select()
      .from(trackerIpv4)
      .where(eq(trackerIpv4.trackerId, row.id))
      .all()
      .map((ipRow) => IpAddress.parse(ipRow.ipv4));
    return Tracker.restore({
      host: TrackerHost.parse(row.host),
      proto: TrackerProto.parse(row.proto),
      port: TrackerPort.parse(row.port),
      privacy: TrackerPrivacy.parse(row.privacy),
      isActive: row.isActive === 1,
      isDead: row.isDead === 1,
      isSsl: row.isSsl === 1,
      checkState: CheckState.parse(row.checkState),
      ipv4: ips,
      ...(row.certExpiration !== null && { certExpiry: CertExpiry.on(row.certExpiration) }),
      ...(row.lastCheck !== null && { lastCheck: row.lastCheck }),
    });
  }
}
