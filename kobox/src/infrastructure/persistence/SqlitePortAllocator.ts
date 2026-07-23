import { and, eq, gte } from 'drizzle-orm';
import { RtorrentPort, ScgiPort } from '../../domain/user/Port.js';
import type { PortAllocatorPort } from '../../domain/user/PortAllocatorPort.js';
import type { KoboxDatabase } from './db.js';
import { allocatedPorts } from './schema.js';

const SCGI_BASE = 51101; // prod convention: 51101..51117 already in use
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
