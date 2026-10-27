import { describe, expect, it } from 'vitest';
import { DeliverNowOrQueue } from '../../../src/application/maintenance/DeliverNowOrQueue.js';
import type {
  MailDelivery,
  MailTransportPort,
} from '../../../src/application/maintenance/MailTransportPort.js';
import { InMemoryMailOutbox } from '../../../src/infrastructure/persistence/InMemoryMailOutbox.js';

const NOW = '2026-10-27 15:00:00';
const DRAFT = { recipient: 'alice@example.org', subject: 'Your link', body: 'Open it' };

class ScriptedRelay implements MailTransportPort {
  readonly handed: MailDelivery[] = [];
  constructor(private readonly answer: 'accepts' | 'refuses') {}

  deliver(mail: MailDelivery): Promise<void> {
    if (this.answer === 'refuses') {
      return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:25'));
    }
    this.handed.push(mail);
    return Promise.resolve();
  }
}

describe('DeliverNowOrQueue', () => {
  it('should_hand_a_mail_to_the_relay_at_once_and_keep_it_only_for_the_record', async () => {
    const relay = new ScriptedRelay('accepts');
    const outbox = new InMemoryMailOutbox();

    await new DeliverNowOrQueue(outbox, relay).enqueue(DRAFT, NOW);

    expect(relay.handed).toEqual([DRAFT]);
    // nothing left for the five-minute pass to send again
    expect(await outbox.listDue(NOW, 10)).toEqual([]);
    expect((await outbox.listRecent(10)).map((mail) => mail.status)).toEqual(['sent']);
  });

  it('should_queue_a_mail_the_relay_did_not_take_for_the_next_pass', async () => {
    const outbox = new InMemoryMailOutbox();

    await new DeliverNowOrQueue(outbox, new ScriptedRelay('refuses')).enqueue(DRAFT, NOW);

    const due = await outbox.listDue(NOW, 10);
    expect(due.map((mail) => [mail.recipient, mail.status])).toEqual([
      ['alice@example.org', 'pending'],
    ]);
  });
});
