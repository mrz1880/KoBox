import type { FormattedEvent, NotificationChannel } from './formatEvent.js';
import type { FetchLike } from './NtfyChannel.js';

const SEND_TIMEOUT_MS = 5_000;

export class DiscordChannel implements NotificationChannel {
  constructor(
    private readonly fetchFn: FetchLike,
    private readonly webhookUrl: string,
  ) {}

  async send(message: FormattedEvent): Promise<void> {
    const response = await this.fetchFn(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `**${message.title}**\n${message.body}` }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`discord webhook answered ${String(response.status)}`);
    }
  }
}
