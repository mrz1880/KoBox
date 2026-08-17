import { eq } from 'drizzle-orm';
import type {
  MailRelayRepository,
  MailRelaySettings,
} from '../../application/maintenance/ConfigureMailRelay.js';
import type { KoboxDatabase } from './db.js';
import { mailRelay } from './schema.js';

const ONLY_ROW = 1;

export class SqliteMailRelayRepository implements MailRelayRepository {
  constructor(private readonly db: KoboxDatabase) {}

  get(): Promise<MailRelaySettings | undefined> {
    const row = this.db.orm.select().from(mailRelay).where(eq(mailRelay.id, ONLY_ROW)).get();
    return Promise.resolve(
      row === undefined
        ? undefined
        : { host: row.host, port: row.port, user: row.user, sealedPassword: row.sealedPassword },
    );
  }

  save(settings: MailRelaySettings): Promise<void> {
    const values = { id: ONLY_ROW, ...settings };
    this.db.orm
      .insert(mailRelay)
      .values(values)
      .onConflictDoUpdate({ target: mailRelay.id, set: values })
      .run();
    return Promise.resolve();
  }
}
