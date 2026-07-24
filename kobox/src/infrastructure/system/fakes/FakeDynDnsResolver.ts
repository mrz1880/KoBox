import type { DynDnsHost } from '../../../domain/security/DynDnsHost.js';
import type { DynDnsResolverPort } from '../../../domain/security/ports.js';
import type { IpAddress } from '../../../domain/shared/IpAddress.js';

export class FakeDynDnsResolver implements DynDnsResolverPort {
  private readonly answers = new Map<string, IpAddress>();

  setAnswer(host: string, ip: IpAddress): void {
    this.answers.set(host, ip);
  }

  clearAnswer(host: string): void {
    this.answers.delete(host);
  }

  resolve(host: DynDnsHost): Promise<IpAddress | undefined> {
    return Promise.resolve(this.answers.get(host.value));
  }
}
