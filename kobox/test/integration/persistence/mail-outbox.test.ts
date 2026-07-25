import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteMailOutbox } from '../../../src/infrastructure/persistence/SqliteMailOutbox.js';

let dir: string;
let db: KoboxDatabase;
let outbox: SqliteMailOutbox;

const DRAFT = {
  recipient: 'admin@example.org',
  subject: 'KoBox alert',
  body: 'fair-use threshold crossed for alice',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-outbox-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  outbox = new SqliteMailOutbox(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteMailOutbox', () => {
  it('should_enqueue_a_pending_mail_due_immediately', async () => {
    const id = await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');

    const due = await outbox.listDue('2026-07-25 10:00:00', 10);

    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe(id);
    expect(due[0]?.recipient).toBe('admin@example.org');
    expect(due[0]?.status).toBe('pending');
    expect(due[0]?.attempts).toBe(0);
  });

  it('should_not_list_a_mail_before_its_next_attempt_time', async () => {
    const id = await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');
    await outbox.markRetry(id, 'relay down', '2026-07-25 10:05:00');

    expect(await outbox.listDue('2026-07-25 10:04:59', 10)).toHaveLength(0);
    const due = await outbox.listDue('2026-07-25 10:05:00', 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.attempts).toBe(1);
    expect(due[0]?.lastError).toBe('relay down');
  });

  it('should_never_list_sent_or_failed_mails', async () => {
    const sent = await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');
    const dead = await outbox.enqueue({ ...DRAFT, subject: 'other' }, '2026-07-25 10:00:00');
    await outbox.markSent(sent, '2026-07-25 10:01:00');
    await outbox.markFailed(dead, 'relay rejected the sender');

    expect(await outbox.listDue('2026-07-26 00:00:00', 10)).toHaveLength(0);
    const recent = await outbox.listRecent(10);
    expect(recent.map((mail) => mail.status).sort()).toEqual(['failed', 'sent']);
    expect(recent.find((mail) => mail.id === sent)?.sentAt).toBe('2026-07-25 10:01:00');
  });

  it('should_respect_the_due_limit_oldest_first', async () => {
    const first = await outbox.enqueue({ ...DRAFT, subject: 'one' }, '2026-07-25 10:00:00');
    await outbox.enqueue({ ...DRAFT, subject: 'two' }, '2026-07-25 10:00:01');

    const due = await outbox.listDue('2026-07-25 11:00:00', 1);

    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe(first);
  });
});
