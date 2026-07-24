import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/infrastructure/logging/logger.js';
import { DiscordChannel } from '../../../src/infrastructure/notifications/DiscordChannel.js';
import { EmailChannel } from '../../../src/infrastructure/notifications/EmailChannel.js';
import { MultiChannelNotifier } from '../../../src/infrastructure/notifications/MultiChannelNotifier.js';
import { NtfyChannel } from '../../../src/infrastructure/notifications/NtfyChannel.js';
import { formatEvent } from '../../../src/infrastructure/notifications/formatEvent.js';
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

describe('formatEvent', () => {
  it('should_give_fair_use_incidents_high_priority', () => {
    const formatted = formatEvent({
      type: 'AbnormalAuthRate',
      username: 'user-h',
      perHour: 82,
      limitPerHour: 30,
    });
    expect(formatted.priority).toBe('high');
    expect(formatted.title).toContain('user-h');
    expect(formatted.body).toContain('82');
    expect(formatted.body).toContain('30');
  });

  it('should_keep_routine_events_at_default_priority', () => {
    const formatted = formatEvent({ type: 'UserCreated', username: 'alice' });
    expect(formatted.priority).toBe('default');
    expect(formatted.title).toContain('alice');
  });

  it('should_describe_a_throttle_with_its_rate', () => {
    const formatted = formatEvent({ type: 'UserThrottled', username: 'user-h', rateBps: 5_000_000 });
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
    );

    await expect(
      notifier.notify({ type: 'UserCreated', username: 'alice' }),
    ).resolves.toBeUndefined();
    expect(discord.calls).toHaveLength(1);
  });
});
