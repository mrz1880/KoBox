import { and, asc, eq, gte } from 'drizzle-orm';
import type { AllocatedPortsPort } from '../../application/user/ReserveMemberPorts.js';
import { FIRST_RTORRENT_PORT, FIRST_SCGI_PORT } from '../../domain/user/memberPortPools.js';
import type { MemberPort } from '../../domain/user/memberPortReservation.js';
import { RtorrentPort, ScgiPort } from '../../domain/user/Port.js';
import type { PortAllocatorPort } from '../../domain/user/PortAllocatorPort.js';
import { PortAlreadyClaimedError } from '../../domain/user/PortAllocatorPort.js';
import type { KoboxDatabase } from './db.js';
import { allocatedPorts } from './schema.js';

type PortKind = (typeof allocatedPorts.kind.enumValues)[number];

function memberPortOf(kind: PortKind, port: number): MemberPort {
  switch (kind) {
    case 'scgi':
      return ScgiPort.parse(port);
    case 'rtorrent':
      return RtorrentPort.parse(port);
  }
}

export class SqlitePortAllocator implements PortAllocatorPort, AllocatedPortsPort {
  constructor(private readonly db: KoboxDatabase) {}

  listAllocated(): Promise<readonly MemberPort[]> {
    const rows = this.db.orm.select().from(allocatedPorts).orderBy(asc(allocatedPorts.port)).all();
    return Promise.resolve(rows.map((row) => memberPortOf(row.kind, row.port)));
  }

  allocateScgiPort(): Promise<ScgiPort> {
    return Promise.resolve(ScgiPort.parse(this.claim('scgi', FIRST_SCGI_PORT)));
  }

  allocateRtorrentPort(): Promise<RtorrentPort> {
    return Promise.resolve(RtorrentPort.parse(this.claim('rtorrent', FIRST_RTORRENT_PORT)));
  }

  releaseScgiPort(port: ScgiPort): Promise<void> {
    this.db.orm.delete(allocatedPorts).where(eq(allocatedPorts.port, port.value)).run();
    return Promise.resolve();
  }

  releaseRtorrentPort(port: RtorrentPort): Promise<void> {
    this.db.orm.delete(allocatedPorts).where(eq(allocatedPorts.port, port.value)).run();
    return Promise.resolve();
  }

  claimScgiPort(port: ScgiPort): Promise<void> {
    return this.claimAsPromise('scgi', port.value);
  }

  claimRtorrentPort(port: RtorrentPort): Promise<void> {
    return this.claimAsPromise('rtorrent', port.value);
  }

  // better-sqlite3 runs the transaction synchronously, so a rejected claim
  // throws *synchronously*; wrap it to honour the async Port contract.
  private claimAsPromise(kind: PortKind, port: number): Promise<void> {
    try {
      this.claimExplicit(kind, port);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Same write-locked transaction as claim(): the existence check + INSERT are
  // atomic, so two concurrent claims of the same legacy port can't both win.
  private claimExplicit(kind: PortKind, port: number): void {
    this.db.orm.transaction(
      (tx) => {
        const taken = tx
          .select({ port: allocatedPorts.port })
          .from(allocatedPorts)
          .where(eq(allocatedPorts.port, port))
          .all();
        if (taken.length > 0) {
          throw new PortAlreadyClaimedError(port);
        }
        tx.insert(allocatedPorts).values({ port, kind }).run();
      },
      { behavior: 'immediate' },
    );
  }

  // Atomicity: the whole find-lowest-free + INSERT runs inside one immediate
  // (write-locked) transaction; the primary key on port is the final arbiter.
  private claim(kind: PortKind, base: number): number {
    return this.db.orm.transaction(
      (tx) => {
        const taken = tx
          .select({ port: allocatedPorts.port })
          .from(allocatedPorts)
          .where(and(eq(allocatedPorts.kind, kind), gte(allocatedPorts.port, base)))
          .all()
          .map((row) => row.port)
          .sort((a, b) => a - b);
        let candidate = base;
        for (const port of taken) {
          if (port !== candidate) {
            break;
          }
          candidate += 1;
        }
        tx.insert(allocatedPorts).values({ port: candidate, kind }).run();
        return candidate;
      },
      { behavior: 'immediate' },
    );
  }
}
