import { describe, expect, it } from 'vitest';
import type { MailDelivery } from '../../../src/application/maintenance/MailTransportPort.js';
import { SendMails } from '../../../src/application/maintenance/SendMails.js';
import { InMemoryMailOutbox } from '../../../src/infrastructure/persistence/InMemoryMailOutbox.js';

class RecordingTransport {
  readonly delivered: MailDelivery[] = [];
  failWith: string | undefined = undefined;

  deliver(mail: MailDelivery): Promise<void> {
    if (this.failWith !== undefined) {
      return Promise.reject(new Error(this.failWith));
    }
    this.delivered.push(mail);
    return Promise.resolve();
  }
}

const DRAFT = {
  recipient: 'admin@example.org',
  subject: 'KoBox alert',
  body: 'disk almost full',
};

function world() {
  const outbox = new InMemoryMailOutbox();
  const transport = new RecordingTransport();
  return { outbox, transport, sendMails: new SendMails({ outbox, transport }) };
}

describe('SendMails', () => {
  it('should_deliver_due_mails_and_mark_them_sent', async () => {
    const { outbox, transport, sendMails } = world();
    await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');

    const report = await sendMails.execute({ now: '2026-07-25 10:00:00' });

    expect(report).toEqual({ sent: 1, retried: 0, failed: 0 });
    expect(transport.delivered).toHaveLength(1);
    expect(transport.delivered[0]?.subject).toBe('KoBox alert');
    expect((await outbox.listRecent(10))[0]?.status).toBe('sent');
  });

  it('should_not_redeliver_a_sent_mail', async () => {
    const { outbox, transport, sendMails } = world();
    await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');
    await sendMails.execute({ now: '2026-07-25 10:00:00' });

    const report = await sendMails.execute({ now: '2026-07-25 10:05:00' });

    expect(report).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(transport.delivered).toHaveLength(1);
  });

  it('should_schedule_a_retry_with_the_backoff_ladder_on_failure', async () => {
    const { outbox, transport, sendMails } = world();
    await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');
    transport.failWith = 'relay down';

    const report = await sendMails.execute({ now: '2026-07-25 10:00:00' });

    expect(report).toEqual({ sent: 0, retried: 1, failed: 0 });
    const mail = (await outbox.listRecent(10))[0];
    expect(mail?.status).toBe('pending');
    expect(mail?.attempts).toBe(1);
    expect(mail?.lastError).toBe('relay down');
    expect(mail?.nextAttemptAt).toBe('2026-07-25 10:05:00'); // +5 min after 1st failure

    // second failure backs off 30 minutes
    await sendMails.execute({ now: '2026-07-25 10:05:00' });
    expect((await outbox.listRecent(10))[0]?.nextAttemptAt).toBe('2026-07-25 10:35:00');
  });

  it('should_not_retry_before_the_scheduled_attempt_time', async () => {
    const { outbox, transport, sendMails } = world();
    await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');
    transport.failWith = 'relay down';
    await sendMails.execute({ now: '2026-07-25 10:00:00' });
    transport.failWith = undefined;

    const early = await sendMails.execute({ now: '2026-07-25 10:04:00' });

    expect(early).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(transport.delivered).toHaveLength(0);
  });

  it('should_declare_the_mail_dead_after_the_fifth_failed_attempt', async () => {
    const { outbox, transport, sendMails } = world();
    await outbox.enqueue(DRAFT, '2026-07-25 10:00:00');
    transport.failWith = 'relay down';

    // walk the whole ladder: 4 retries then terminal failure
    let now = '2026-07-25 10:00:00';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await sendMails.execute({ now });
      now = (await outbox.listRecent(1))[0]?.nextAttemptAt ?? now;
    }
    const final = await sendMails.execute({ now });

    expect(final).toEqual({ sent: 0, retried: 0, failed: 1 });
    const mail = (await outbox.listRecent(10))[0];
    expect(mail?.status).toBe('failed');
    expect(mail?.attempts).toBe(5);
    // a dead mail never comes back
    expect(await sendMails.execute({ now: '2026-08-01 00:00:00' })).toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
  });
});
