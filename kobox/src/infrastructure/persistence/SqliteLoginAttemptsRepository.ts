import { eq } from 'drizzle-orm';
import type { LoginAttempt, LoginAttemptsPort } from '../../domain/portal/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { loginAttempts } from './schema.js';

export class SqliteLoginAttemptsRepository implements LoginAttemptsPort {
  constructor(private readonly db: KoboxDatabase) {}

  get(username: Username): Promise<LoginAttempt | undefined> {
    const row = this.db.orm
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.username, username.value))
      .get();
    if (row === undefined) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      username: Username.parse(row.username),
      failures: row.failures,
      ...(row.lockedUntil !== null && { lockedUntil: row.lockedUntil }),
    });
  }

  save(attempt: LoginAttempt): Promise<void> {
    this.db.orm
      .insert(loginAttempts)
      .values({
        username: attempt.username.value,
        failures: attempt.failures,
        lockedUntil: attempt.lockedUntil ?? null,
      })
      .onConflictDoUpdate({
        target: loginAttempts.username,
        set: { failures: attempt.failures, lockedUntil: attempt.lockedUntil ?? null },
      })
      .run();
    return Promise.resolve();
  }

  clear(username: Username): Promise<void> {
    this.db.orm.delete(loginAttempts).where(eq(loginAttempts.username, username.value)).run();
    return Promise.resolve();
  }
}
