import type { SshAuthLogPort } from '../../../domain/security/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeSshAuthLog implements SshAuthLogPort {
  private readonly counts = new Map<string, number>();

  setCount(username: string, count: number): void {
    this.counts.set(username, count);
  }

  countAcceptedPublickey(username: Username, _windowMinutes: number): Promise<number> {
    return Promise.resolve(this.counts.get(username.value) ?? 0);
  }
}
