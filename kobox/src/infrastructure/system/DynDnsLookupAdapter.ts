import { lookup } from 'node:dns/promises';
import type { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import type { DynDnsResolverPort } from '../../domain/security/ports.js';
import { IPV4_PATTERN, IpAddress } from '../../domain/shared/IpAddress.js';

type LookupFn = (hostname: string) => Promise<{ address: string }>;

const defaultLookup: LookupFn = (hostname) => lookup(hostname, { family: 4 });

// getaddrinfo-backed (honors /etc/hosts — the local-fixture seam for tests
// and the E2E container). NXDOMAIN and transport failures are soft undefined:
// the caller keeps the last known address.
export class DynDnsLookupAdapter implements DynDnsResolverPort {
  constructor(private readonly lookupFn: LookupFn = defaultLookup) {}

  async resolve(host: DynDnsHost): Promise<IpAddress | undefined> {
    try {
      const { address } = await this.lookupFn(host.value);
      return IPV4_PATTERN.test(address) ? IpAddress.parse(address) : undefined;
    } catch {
      return undefined;
    }
  }
}
