import { and, eq } from 'drizzle-orm';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import type { UserAddress, UserAddressRepository } from '../../domain/tracker/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { userAddresses } from './schema.js';

export class SqliteUserAddressRepository implements UserAddressRepository {
  constructor(private readonly db: KoboxDatabase) {}

  listAll(): Promise<readonly UserAddress[]> {
    const rows = this.db.orm.select().from(userAddresses).all();
    return Promise.resolve(
      rows.map((row) => ({
        username: Username.parse(row.username),
        ip: IpAddress.parse(row.ipv4),
      })),
    );
  }

  add(username: Username, ip: IpAddress): Promise<void> {
    this.db.orm
      .insert(userAddresses)
      .values({ username: username.value, ipv4: ip.value })
      .onConflictDoNothing()
      .run();
    return Promise.resolve();
  }

  remove(username: Username, ip: IpAddress): Promise<void> {
    this.db.orm
      .delete(userAddresses)
      .where(and(eq(userAddresses.username, username.value), eq(userAddresses.ipv4, ip.value)))
      .run();
    return Promise.resolve();
  }
}
