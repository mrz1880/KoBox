import { eq, lt } from 'drizzle-orm';
import type { PortalSessionRecord, SessionStorePort } from '../../domain/portal/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { portalSessions } from './schema.js';

export class SqlitePortalSessionRepository implements SessionStorePort {
  constructor(private readonly db: KoboxDatabase) {}

  create(session: PortalSessionRecord): Promise<void> {
    this.db.orm
      .insert(portalSessions)
      .values({
        id: session.id,
        username: session.username.value,
        csrfToken: session.csrfToken,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
      .run();
    return Promise.resolve();
  }

  find(id: string): Promise<PortalSessionRecord | undefined> {
    const row = this.db.orm.select().from(portalSessions).where(eq(portalSessions.id, id)).get();
    if (row === undefined) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      id: row.id,
      username: Username.parse(row.username),
      csrfToken: row.csrfToken,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    });
  }

  delete(id: string): Promise<void> {
    this.db.orm.delete(portalSessions).where(eq(portalSessions.id, id)).run();
    return Promise.resolve();
  }

  deleteForUser(username: Username): Promise<void> {
    this.db.orm.delete(portalSessions).where(eq(portalSessions.username, username.value)).run();
    return Promise.resolve();
  }

  purgeExpired(now: string): Promise<number> {
    const result = this.db.orm.delete(portalSessions).where(lt(portalSessions.expiresAt, now)).run();
    return Promise.resolve(result.changes);
  }
}
