import type { FormattedEvent, NotificationChannel } from './formatEvent.js';

export type FetchLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

const SEND_TIMEOUT_MS = 5_000;

export class NtfyChannel implements NotificationChannel {
  constructor(
    private readonly fetchFn: FetchLike,
    private readonly url: string,
  ) {}

  async send(message: FormattedEvent): Promise<void> {
    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { Title: message.title, Priority: message.priority },
      body: message.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`ntfy answered ${String(response.status)}`);
    }
  }
}
