import { and, count, desc, eq, gte, isNull } from 'drizzle-orm';
import { PasswordLink } from '../../domain/portal/PasswordLink.js';
import type { PasswordLinkRepository } from '../../domain/portal/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { passwordLinks } from './schema.js';

type Row = typeof passwordLinks.$inferSelect;

function toDomain(row: Row): PasswordLink {
  return PasswordLink.restore({
    username: Username.parse(row.username),
    purpose: row.purpose,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    ...(row.usedAt !== null && { usedAt: row.usedAt }),
  });
}

export class SqlitePasswordLinkRepository implements PasswordLinkRepository {
  constructor(private readonly db: KoboxDatabase) {}

  save(link: PasswordLink, now: string): Promise<void> {
    this.db.orm
      .insert(passwordLinks)
      .values({
        username: link.username.value,
        purpose: link.purpose,
        tokenHash: link.tokenHash,
        expiresAt: link.expiresAt,
        usedAt: link.usedAt ?? null,
        issuedAt: now,
      })
      .onConflictDoUpdate({ target: passwordLinks.tokenHash, set: { usedAt: link.usedAt ?? null } })
      .run();
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<PasswordLink | undefined> {
    const row = this.db.orm
      .select()
      .from(passwordLinks)
      .where(eq(passwordLinks.tokenHash, tokenHash))
      .get();
    return Promise.resolve(row === undefined ? undefined : toDomain(row));
  }

  closeOpen(username: Username, now: string): Promise<void> {
    this.db.orm
      .update(passwordLinks)
      .set({ usedAt: now })
      .where(and(eq(passwordLinks.username, username.value), isNull(passwordLinks.usedAt)))
      .run();
    return Promise.resolve();
  }

  countIssuedSince(username: Username, since: string): Promise<number> {
    const row = this.db.orm
      .select({ n: count() })
      .from(passwordLinks)
      .where(and(eq(passwordLinks.username, username.value), gte(passwordLinks.issuedAt, since)))
      .get();
    return Promise.resolve(row?.n ?? 0);
  }

  latest(username: Username): Promise<PasswordLink | undefined> {
    const row = this.db.orm
      .select()
      .from(passwordLinks)
      .where(eq(passwordLinks.username, username.value))
      .orderBy(desc(passwordLinks.id))
      .limit(1)
      .get();
    return Promise.resolve(row === undefined ? undefined : toDomain(row));
  }

  deleteForUser(username: Username): Promise<void> {
    this.db.orm.delete(passwordLinks).where(eq(passwordLinks.username, username.value)).run();
    return Promise.resolve();
  }
}
