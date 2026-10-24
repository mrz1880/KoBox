import type { PasswordLink } from '../../domain/portal/PasswordLink.js';
import type { PasswordLinkRepository } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Stored {
  link: PasswordLink;
  readonly issuedAt: string;
}

export class InMemoryPasswordLinkRepository implements PasswordLinkRepository {
  private readonly rows: Stored[] = [];

  save(link: PasswordLink, now: string): Promise<void> {
    const existing = this.rows.find((row) => row.link.tokenHash === link.tokenHash);
    if (existing === undefined) {
      this.rows.push({ link, issuedAt: now });
    } else {
      existing.link = link;
    }
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<PasswordLink | undefined> {
    return Promise.resolve(this.rows.find((row) => row.link.tokenHash === tokenHash)?.link);
  }

  closeOpen(username: Username, now: string): Promise<void> {
    for (const row of this.rows) {
      if (row.link.username.equals(username) && row.link.usedAt === undefined) {
        row.link = row.link.closedAt(now);
      }
    }
    return Promise.resolve();
  }

  countIssuedSince(username: Username, since: string): Promise<number> {
    return Promise.resolve(
      this.rows.filter((row) => row.link.username.equals(username) && row.issuedAt >= since).length,
    );
  }

  latest(username: Username): Promise<PasswordLink | undefined> {
    return Promise.resolve(this.rows.filter((row) => row.link.username.equals(username)).at(-1)?.link);
  }

  deleteForUser(username: Username): Promise<void> {
    const kept = this.rows.filter((row) => !row.link.username.equals(username));
    this.rows.splice(0, this.rows.length, ...kept);
    return Promise.resolve();
  }
}
