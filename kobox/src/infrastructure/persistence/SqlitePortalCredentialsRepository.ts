import { eq } from 'drizzle-orm';
import type { PortalCredentials, PortalCredentialsPort } from '../../domain/portal/ports.js';
import { HashedPassword } from '../../domain/user/HashedPassword.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { portalCredentials } from './schema.js';

export class SqlitePortalCredentialsRepository implements PortalCredentialsPort {
  constructor(private readonly db: KoboxDatabase) {}

  find(username: Username): Promise<PortalCredentials | undefined> {
    const row = this.db.orm
      .select()
      .from(portalCredentials)
      .where(eq(portalCredentials.username, username.value))
      .get();
    if (row === undefined) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      username: Username.parse(row.username),
      passwordHash: HashedPassword.parse(row.passwordHash),
      role: row.role,
      mustChangePassword: row.mustChangePassword === 1,
      ...(row.appTokenHash !== null && { appTokenHash: row.appTokenHash }),
    });
  }

  save(credentials: PortalCredentials, now: string): Promise<void> {
    const mustChange = credentials.mustChangePassword === true ? 1 : 0;
    this.db.orm
      .insert(portalCredentials)
      .values({
        username: credentials.username.value,
        passwordHash: credentials.passwordHash.value,
        role: credentials.role,
        mustChangePassword: mustChange,
        appTokenHash: credentials.appTokenHash ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: portalCredentials.username,
        set: {
          passwordHash: credentials.passwordHash.value,
          role: credentials.role,
          mustChangePassword: mustChange,
          appTokenHash: credentials.appTokenHash ?? null,
          updatedAt: now,
        },
      })
      .run();
    return Promise.resolve();
  }

  delete(username: Username): Promise<void> {
    this.db.orm
      .delete(portalCredentials)
      .where(eq(portalCredentials.username, username.value))
      .run();
    return Promise.resolve();
  }
}
