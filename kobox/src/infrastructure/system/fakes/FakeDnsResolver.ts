import type { IpAddress } from '../../../domain/shared/IpAddress.js';
import type { TrackerHost } from '../../../domain/tracker/TrackerHost.js';
import type { DnsResolverPort } from '../../../domain/tracker/ports.js';

export class FakeDnsResolver implements DnsResolverPort {
  private readonly byHost = new Map<string, readonly IpAddress[]>();

  givenAddresses(host: string, addresses: readonly IpAddress[]): void {
    this.byHost.set(host, addresses);
  }

  resolveA(host: TrackerHost): Promise<readonly IpAddress[]> {
    return Promise.resolve(this.byHost.get(host.value) ?? []);
  }
}
