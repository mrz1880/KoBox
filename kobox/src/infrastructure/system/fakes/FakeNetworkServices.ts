import type { NetworkServicePort } from '../../../domain/security/ports.js';

export class FakeNetworkServices implements NetworkServicePort {
  readonly reloads: string[] = [];
  private failure: Error | undefined;

  failWith(error: Error): void {
    this.failure = error;
  }

  reloadFail2ban(): Promise<void> {
    return this.record('fail2ban');
  }

  reloadDns(): Promise<void> {
    return this.record('dns');
  }

  reloadPeerGuardian(): Promise<void> {
    return this.record('pgl');
  }

  private record(name: string): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    this.reloads.push(name);
    return Promise.resolve();
  }
}
