import { eq } from 'drizzle-orm';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { ProxyPort, RtorrentPort, ScgiPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { SeedboxUser } from '../../domain/user/SeedboxUser.js';
import { UserId } from '../../domain/user/UserId.js';
import { UserStatus } from '../../domain/user/UserStatus.js';
import { Username } from '../../domain/user/Username.js';
import { VpnHost } from '../../domain/user/VpnHost.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { KoboxDatabase } from './db.js';
import { allocatedPorts, users } from './schema.js';

type UserRow = typeof users.$inferSelect;

function toDomain(row: UserRow): SeedboxUser {
  return SeedboxUser.restore({
    id: UserId.parse(row.id),
    username: Username.parse(row.username),
    email: EmailAddress.parse(row.email),
    quota: Quota.bytes(row.quotaBytes),
    scgiPort: ScgiPort.parse(row.scgiPort),
    rtorrentPort: RtorrentPort.parse(row.rtorrentPort),
    proxyPort: ProxyPort.parse(row.proxyPort),
    status: UserStatus.parse(row.status),
    ...(row.vpnHost !== null && { vpnHost: VpnHost.parse(row.vpnHost) }),
  });
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: KoboxDatabase) {}

  findByUsername(username: Username): Promise<SeedboxUser | undefined> {
    const row = this.db.orm.select().from(users).where(eq(users.username, username.value)).get();
    return Promise.resolve(row ? toDomain(row) : undefined);
  }

  listAll(): Promise<readonly SeedboxUser[]> {
    return Promise.resolve(this.db.orm.select().from(users).all().map(toDomain));
  }

  save(user: SeedboxUser): Promise<SeedboxUser> {
    try {
      return Promise.resolve(this.saveSync(user));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private saveSync(user: SeedboxUser): SeedboxUser {
    const values = {
      username: user.username.value,
      email: user.email.value,
      quotaBytes: user.quota.toBytes(),
      scgiPort: user.scgiPort.value,
      rtorrentPort: user.rtorrentPort.value,
      proxyPort: user.proxyPort.value,
      status: user.status.value,
    };
    if (user.id) {
      this.db.orm.update(users).set(values).where(eq(users.id, user.id.value)).run();
      return user;
    }
    // lowest free host and insert in one write transaction: two members created
    // at once cannot be handed the same address
    return this.db.orm.transaction(
      (tx) => {
        const taken = tx
          .select({ vpnHost: users.vpnHost })
          .from(users)
          .all()
          .flatMap((row) => (row.vpnHost === null ? [] : [VpnHost.parse(row.vpnHost)]));
        const vpnHost = VpnHost.lowestFree(taken);
        const inserted = tx
          .insert(users)
          .values({ ...values, vpnHost: vpnHost.value })
          .returning({ id: users.id })
          .get();
        return user.identifiedBy(UserId.parse(inserted.id)).placedAt(vpnHost);
      },
      { behavior: 'immediate' },
    );
  }

  delete(username: Username): Promise<void> {
    this.db.orm.transaction((tx) => {
      const row = tx.select().from(users).where(eq(users.username, username.value)).get();
      if (!row) {
        return;
      }
      tx.delete(allocatedPorts).where(eq(allocatedPorts.port, row.scgiPort)).run();
      tx.delete(allocatedPorts).where(eq(allocatedPorts.port, row.rtorrentPort)).run();
      tx.delete(users).where(eq(users.id, row.id)).run();
    });
    return Promise.resolve();
  }
}
