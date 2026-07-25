import type { PortalSessionRecord, SessionStorePort } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryPortalSessionRepository implements SessionStorePort {
  private readonly rows = new Map<string, PortalSessionRecord>();

  create(session: PortalSessionRecord): Promise<void> {
    this.rows.set(session.id, session);
    return Promise.resolve();
  }

  find(id: string): Promise<PortalSessionRecord | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  delete(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  deleteForUser(username: Username): Promise<void> {
    for (const [id, session] of this.rows) {
      if (session.username.value === username.value) {
        this.rows.delete(id);
      }
    }
    return Promise.resolve();
  }

  purgeExpired(now: string): Promise<number> {
    let purged = 0;
    for (const [id, session] of this.rows) {
      if (session.expiresAt < now) {
        this.rows.delete(id);
        purged += 1;
      }
    }
    return Promise.resolve(purged);
  }
}
