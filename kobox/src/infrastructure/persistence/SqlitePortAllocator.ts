import { and, eq, gte } from 'drizzle-orm';
import { RtorrentPort, ScgiPort } from '../../domain/user/Port.js';
import type { PortAllocatorPort } from '../../domain/user/PortAllocatorPort.js';
import { PortAlreadyClaimedError } from '../../domain/user/PortAllocatorPort.js';
import type { KoboxDatabase } from './db.js';
import { allocatedPorts } from './schema.js';

const SCGI_BASE = 51101; // SCGI listeners for per-user rtorrent instances
const RTORRENT_BASE = 45000;

export class SqlitePortAllocator implements PortAllocatorPort {
  constructor(private readonly db: KoboxDatabase) {}

  allocateScgiPort(): Promise<ScgiPort> {
    return Promise.resolve(ScgiPort.parse(this.claim('scgi', SCGI_BASE)));
  }

  allocateRtorrentPort(): Promise<RtorrentPort> {
    return Promise.resolve(RtorrentPort.parse(this.claim('rtorrent', RTORRENT_BASE)));
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
  private claimAsPromise(kind: 'scgi' | 'rtorrent', port: number): Promise<void> {
    try {
      this.claimExplicit(kind, port);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Same write-locked transaction as claim(): the existence check + INSERT are
  // atomic, so two concurrent claims of the same legacy port can't both win.
  private claimExplicit(kind: 'scgi' | 'rtorrent', port: number): void {
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
  private claim(kind: 'scgi' | 'rtorrent', base: number): number {
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
