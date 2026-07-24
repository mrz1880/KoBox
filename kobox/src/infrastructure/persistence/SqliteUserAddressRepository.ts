import { and, eq, isNotNull } from 'drizzle-orm';
import { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import type { DynDnsBinding, DynDnsBindingRepository } from '../../domain/security/ports.js';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import type { UserAddress, UserAddressRepository } from '../../domain/tracker/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { userAddresses } from './schema.js';

// One table, two views: the tracker context sees resolved {username, ip}
// pairs (static rows plus resolved hostname rows); the security context
// manages the DynDNS hostname bindings behind them.
export class SqliteUserAddressRepository implements UserAddressRepository, DynDnsBindingRepository {
  constructor(private readonly db: KoboxDatabase) {}

  listAll(): Promise<readonly UserAddress[]> {
    const rows = this.db.orm
      .select()
      .from(userAddresses)
      .where(isNotNull(userAddresses.ipv4))
      .all();
    return Promise.resolve(
      rows.map((row) => ({
        username: Username.parse(row.username),
        ip: IpAddress.parse(row.ipv4 ?? ''),
      })),
    );
  }

  add(username: Username, ip: IpAddress): Promise<void> {
    this.db.orm
      .insert(userAddresses)
      .values({ username: username.value, ipv4: ip.value, checkBy: 'ipv4' })
      .onConflictDoNothing()
      .run();
    return Promise.resolve();
  }

  remove(username: Username, ip: IpAddress): Promise<void> {
    this.db.orm
      .delete(userAddresses)
      .where(
        and(
          eq(userAddresses.username, username.value),
          eq(userAddresses.ipv4, ip.value),
          eq(userAddresses.checkBy, 'ipv4'),
        ),
      )
      .run();
    return Promise.resolve();
  }

  listHostnames(): Promise<readonly DynDnsBinding[]> {
    const rows = this.db.orm
      .select()
      .from(userAddresses)
      .where(eq(userAddresses.checkBy, 'hostname'))
      .all();
    return Promise.resolve(
      rows.map((row) => ({
        username: Username.parse(row.username),
        host: DynDnsHost.parse(row.hostname ?? ''),
        ...(row.ipv4 !== null && { resolvedIp: IpAddress.parse(row.ipv4) }),
      })),
    );
  }

  addHostname(username: Username, host: DynDnsHost): Promise<void> {
    this.db.orm
      .insert(userAddresses)
      .values({ username: username.value, hostname: host.value, checkBy: 'hostname' })
      .onConflictDoNothing()
      .run();
    return Promise.resolve();
  }

  removeHostname(username: Username, host: DynDnsHost): Promise<void> {
    this.db.orm
      .delete(userAddresses)
      .where(
        and(eq(userAddresses.username, username.value), eq(userAddresses.hostname, host.value)),
      )
      .run();
    return Promise.resolve();
  }

  updateResolvedIp(username: Username, host: DynDnsHost, ip: IpAddress): Promise<void> {
    this.db.raw.transaction(() => {
      // absorb a redundant static row for the same address: the hostname
      // binding tracks it from now on (and UNIQUE(username, ipv4) would
      // otherwise fail this update forever — the static->dyndns migration)
      this.db.orm
        .delete(userAddresses)
        .where(
          and(
            eq(userAddresses.username, username.value),
            eq(userAddresses.ipv4, ip.value),
            eq(userAddresses.checkBy, 'ipv4'),
          ),
        )
        .run();
      this.db.orm
        .update(userAddresses)
        .set({ ipv4: ip.value })
        .where(
          and(eq(userAddresses.username, username.value), eq(userAddresses.hostname, host.value)),
        )
        .run();
    })();
    return Promise.resolve();
  }
}
