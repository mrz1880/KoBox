import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/infrastructure/logging/logger.js';
import { DiscordChannel } from '../../../src/infrastructure/notifications/DiscordChannel.js';
import { EmailChannel } from '../../../src/infrastructure/notifications/EmailChannel.js';
import { MultiChannelNotifier } from '../../../src/infrastructure/notifications/MultiChannelNotifier.js';
import { NtfyChannel } from '../../../src/infrastructure/notifications/NtfyChannel.js';
import { OutboxEmailChannel } from '../../../src/infrastructure/notifications/OutboxEmailChannel.js';
import { SendmailTransport } from '../../../src/infrastructure/notifications/SendmailTransport.js';
import { InMemoryMailOutbox } from '../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryPortalCredentialsRepository } from '../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryUserRepository } from '../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { AccountNoticesToAdmins } from '../../../src/infrastructure/notifications/AccountNoticesToAdmins.js';
import { EmailAddress } from '../../../src/domain/user/EmailAddress.js';
import { Username } from '../../../src/domain/user/Username.js';
import { UserBuilder } from '../../builders/UserBuilder.js';
import { formatEvent, type AnyDomainEvent } from '../../../src/infrastructure/notifications/formatEvent.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../src/infrastructure/system/CommandRunner.js';

process.env.KOBOX_LOG_LEVEL = 'silent';
const logger = createLogger('test');

interface RecordedFetch {
  readonly url: string;
  readonly init: { method?: string; headers?: Record<string, string>; body?: string };
}

function recordingFetch(status = 200): {
  calls: RecordedFetch[];
  fetch: (url: string, init: RecordedFetch['init']) => Promise<{ ok: boolean; status: number }>;
} {
  const calls: RecordedFetch[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: status < 400, status });
    },
  };
}

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

const NOW_STAMP = '2026-10-27 12:00:00';

const context = {
  box: 'box.example.org',
  portalUrl: 'https://box.example.org',
  at: '2026-10-25 09:12:03',
};

// One of each event: a new one added to the union and not here fails the
// exhaustiveness of formatEvent at compile time, not here.
const EVERY_EVENT: readonly AnyDomainEvent[] = [
  { type: 'UserCreated', username: 'alice' },
  { type: 'UserDeleted', username: 'alice' },
  { type: 'PasswordChanged', username: 'alice' },
  { type: 'UserSuspended', username: 'alice' },
  { type: 'UserResumed', username: 'alice' },
  { type: 'PasswordResetRequested', username: 'alice' },
  { type: 'TrackerDiscovered', host: 'tracker.example.org' },
  { type: 'TrackerDied', host: 'tracker.example.org' },
  { type: 'TrackerCertRenewed', host: 'tracker.example.org', expiresOn: '2027-01-24' },
  { type: 'BlocklistUpdateFailed', author: 'bluetack', name: 'level1' },
  { type: 'FairUseBreached', username: 'alice', metric: 'egress', observedBps: 90_000_000, limitBps: 50_000_000 },
  { type: 'AbnormalAuthRate', username: 'alice', perHour: 82, limitPerHour: 30 },
  { type: 'ServiceUnhealthy', username: 'alice', detail: 'rtorrent-alice is not running' },
  { type: 'UserThrottled', username: 'alice', rateBps: 5_000_000 },
  { type: 'FairUseRecovered', username: 'alice' },
  { type: 'DynDnsAddressChanged', username: 'alice', host: 'dyn.example.org', oldIp: '203.0.113.9', newIp: '198.51.100.7' },
  { type: 'FirewallApplied', outcome: 'rolled-back' },
];

describe('formatEvent', () => {
  it.each(EVERY_EVENT.map((event) => [event.type, event] as const))(
    'should_say_what_happened_when_and_where_for_%s',
    (type, event) => {
      const formatted = formatEvent(event, context);

      // a sentence, not the bare name of the event
      expect(formatted.title).not.toContain(type);
      expect(formatted.body).not.toBe(type);
      expect(formatted.body.split('\n').length).toBeGreaterThan(3);
      expect(formatted.body).toContain('2026-10-25 09:12:03 UTC');
      expect(formatted.body).toContain('box.example.org');
      expect(formatted.body).toMatch(/https:\/\/box\.example\.org\/\S+/);
    },
  );

  it('should_send_an_admin_to_the_page_of_the_member_concerned', () => {
    const formatted = formatEvent({ type: 'UserSuspended', username: 'alice' }, context);

    expect(formatted.title).toBe('[box.example.org] Member suspended: alice');
    expect(formatted.body).toContain('https://box.example.org/admin/users/alice');
  });

  it('should_tell_what_a_password_change_took_with_it', () => {
    const body = formatEvent({ type: 'PasswordChanged', username: 'alice' }, context).body;

    expect(body).toContain('portal, SFTP, Samba and Nextcloud');
    // the app token goes with the old password: Sonarr and Radarr need a new one
    expect(body).toContain('app token');
  });

  it('should_say_who_asked_for_a_new_password_and_what_to_do_if_it_was_not_them', () => {
    const formatted = formatEvent({ type: 'PasswordResetRequested', username: 'alice' }, context);
    expect(formatted.title).toContain('alice');
    expect(formatted.body).toContain('suspend');
  });

  it('should_give_fair_use_incidents_high_priority', () => {
    const formatted = formatEvent(
      { type: 'AbnormalAuthRate', username: 'user-h', perHour: 82, limitPerHour: 30 },
      context,
    );
    expect(formatted.priority).toBe('high');
    expect(formatted.title).toContain('user-h');
    expect(formatted.body).toContain('82');
    expect(formatted.body).toContain('30');
  });

  it('should_keep_routine_events_at_default_priority', () => {
    const formatted = formatEvent({ type: 'UserCreated', username: 'alice' }, context);
    expect(formatted.priority).toBe('default');
    expect(formatted.title).toContain('alice');
  });

  it('should_describe_a_throttle_with_its_rate', () => {
    const formatted = formatEvent(
      { type: 'UserThrottled', username: 'user-h', rateBps: 5_000_000 },
      context,
    );
    expect(formatted.priority).toBe('high');
    expect(formatted.body).toContain('5 Mbit/s');
  });
});

describe('NtfyChannel', () => {
  it('should_post_the_body_with_title_and_priority_headers', async () => {
    const { calls, fetch } = recordingFetch();
    const channel = new NtfyChannel(fetch, 'https://ntfy.example.net/kobox');

    await channel.send({ title: 'KoBox: alert', body: 'details', priority: 'high' });

    expect(calls[0]?.url).toBe('https://ntfy.example.net/kobox');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers?.Title).toBe('KoBox: alert');
    expect(calls[0]?.init.headers?.Priority).toBe('high');
    expect(calls[0]?.init.body).toBe('details');
  });

  it('should_throw_on_a_non_2xx_answer', async () => {
    const { fetch } = recordingFetch(500);
    const channel = new NtfyChannel(fetch, 'https://ntfy.example.net/kobox');
    await expect(
      channel.send({ title: 't', body: 'b', priority: 'default' }),
    ).rejects.toThrow('500');
  });
});

describe('DiscordChannel', () => {
  it('should_post_the_webhook_json', async () => {
    const { calls, fetch } = recordingFetch();
    const channel = new DiscordChannel(fetch, 'https://discord.example.net/api/webhooks/x/y');

    await channel.send({ title: 'KoBox: alert', body: 'details', priority: 'high' });

    expect(calls[0]?.init.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual({
      content: '**KoBox: alert**\ndetails',
    });
  });
});

describe('EmailChannel', () => {
  it('should_pipe_a_complete_message_through_sendmail', async () => {
    const runner = new RecordingRunner();
    const channel = new EmailChannel(runner, 'admin@example.org');

    await channel.send({ title: 'KoBox: alert', body: 'details', priority: 'high' });

    expect(runner.calls[0]?.command).toBe('sendmail');
    expect(runner.calls[0]?.args).toEqual(['-t']);
    expect(runner.calls[0]?.stdin).toContain('To: admin@example.org');
    expect(runner.calls[0]?.stdin).toContain('Subject: KoBox: alert');
    expect(runner.calls[0]?.stdin).toContain('details');
  });
});

describe('SendmailTransport', () => {
  it('should_pipe_a_complete_delivery_through_sendmail', async () => {
    const runner = new RecordingRunner();
    const transport = new SendmailTransport(runner);

    await transport.deliver({
      recipient: 'admin@example.org',
      subject: 'KoBox: alert',
      body: 'details',
    });

    expect(runner.calls[0]?.command).toBe('sendmail');
    expect(runner.calls[0]?.args).toEqual(['-t']);
    expect(runner.calls[0]?.stdin).toContain('To: admin@example.org');
    expect(runner.calls[0]?.stdin).toContain('Subject: KoBox: alert');
    expect(runner.calls[0]?.stdin).toContain('details');
  });
});

describe('OutboxEmailChannel', () => {
  it('should_enqueue_a_pending_outbox_row_instead_of_sending', async () => {
    const outbox = new InMemoryMailOutbox();
    const channel = new OutboxEmailChannel(outbox, 'admin@example.org', () => '2026-07-25 10:00:00');

    await channel.send({ title: 'KoBox: alert', body: 'details', priority: 'high' });

    const rows = await outbox.listRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.recipient).toBe('admin@example.org');
    expect(rows[0]?.subject).toBe('KoBox: alert');
    expect(rows[0]?.body).toBe('details');
    expect(rows[0]?.nextAttemptAt).toBe('2026-07-25 10:00:00');
  });
});

describe('MultiChannelNotifier', () => {
  it('should_fan_out_every_event_to_every_channel', async () => {
    const ntfy = recordingFetch();
    const discord = recordingFetch();
    const runner = new RecordingRunner();
    const notifier = new MultiChannelNotifier(
      [
        new NtfyChannel(ntfy.fetch, 'https://ntfy.example.net/kobox'),
        new DiscordChannel(discord.fetch, 'https://discord.example.net/api/webhooks/x/y'),
        new EmailChannel(runner, 'admin@example.org'),
      ],
      logger,
      () => Promise.resolve(context),
    );

    await notifier.notify({ type: 'AbnormalAuthRate', username: 'user-h', perHour: 82, limitPerHour: 30 });

    expect(ntfy.calls).toHaveLength(1);
    expect(discord.calls).toHaveLength(1);
    expect(runner.calls).toHaveLength(1);
  });

  it('should_never_let_one_failing_channel_break_the_others_or_the_caller', async () => {
    const failing = new NtfyChannel(() => Promise.reject(new Error('down')), 'https://x.example');
    const discord = recordingFetch();
    const notifier = new MultiChannelNotifier(
      [failing, new DiscordChannel(discord.fetch, 'https://discord.example.net/api/webhooks/x/y')],
      logger,
      () => Promise.resolve(context),
    );

    await expect(
      notifier.notify({ type: 'UserCreated', username: 'alice' }),
    ).resolves.toBeUndefined();
    expect(discord.calls).toHaveLength(1);
  });
});

describe('AccountNoticesToAdmins', () => {
  async function world() {
    const users = new InMemoryUserRepository();
    const credentials = new InMemoryPortalCredentialsRepository();
    for (const [name, role] of [
      ['boss', 'admin'],
      ['guigui', 'admin'],
      ['alice', 'user'],
    ] as const) {
      await users.save(new UserBuilder().withUsername(name).withEmail(`${name}@example.org`).build());
      await credentials.save({ username: Username.parse(name), role }, NOW_STAMP);
    }
    const outbox = new InMemoryMailOutbox();
    const operator: AnyDomainEvent[] = [];
    const notifier = new AccountNoticesToAdmins({
      operator: { notify: (event) => Promise.resolve(void operator.push(event)) },
      users,
      credentials,
      outbox,
      context: () => Promise.resolve(context),
      now: () => NOW_STAMP,
      // the operator's alert address already gets everything
      alreadyMailed: EmailAddress.parse('boss@example.org'),
    });
    return { notifier, outbox, operator };
  }

  it('should_mail_every_admin_who_joins_leaves_or_asks_for_a_new_password', async () => {
    const { notifier, outbox, operator } = await world();

    await notifier.notify({ type: 'PasswordResetRequested', username: 'alice' });

    const mails = await outbox.listRecent(10);
    expect(mails.map((mail) => mail.recipient)).toEqual(['guigui@example.org']);
    expect(mails[0]?.subject).toContain('alice');
    expect(operator.map((event) => event.type)).toEqual(['PasswordResetRequested']);
  });

  it('should_leave_every_other_event_to_the_operator_channels', async () => {
    const { notifier, outbox, operator } = await world();

    await notifier.notify({ type: 'TrackerDied', host: 'tracker.example.org' });
    await notifier.notify({ type: 'UserSuspended', username: 'alice' });

    expect(await outbox.listRecent(10)).toEqual([]);
    expect(operator).toHaveLength(2);
  });
});
