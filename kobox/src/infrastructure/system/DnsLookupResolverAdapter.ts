import { lookup } from 'node:dns/promises';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import type { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import type { DnsResolverPort } from '../../domain/tracker/ports.js';

export interface LookupEntry {
  readonly address: string;
  readonly family: number;
}

export type LookupFn = (hostname: string) => Promise<readonly LookupEntry[]>;

// getaddrinfo (not resolve4) on purpose: it honors /etc/hosts, which both the
// container E2E and any operator override rely on.
const defaultLookup: LookupFn = (hostname) => lookup(hostname, { all: true, family: 4 });

const NO_ANSWER_CODES = new Set(['ENOTFOUND', 'ENODATA']);

export class DnsLookupResolverAdapter implements DnsResolverPort {
  constructor(private readonly lookupFn: LookupFn = defaultLookup) {}

  async resolveA(host: TrackerHost): Promise<readonly IpAddress[]> {
    let entries: readonly LookupEntry[];
    try {
      entries = await this.lookupFn(host.value);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (NO_ANSWER_CODES.has(code)) {
        return []; // definitive: the name does not resolve
      }
      throw error instanceof Error ? error : new Error(String(error));
      // transient failures (EAI_AGAIN, ETIMEOUT) propagate — they must not
      // read as "tracker is dead"
    }
    return entries
      .filter((entry) => entry.family === 4)
      .map((entry) => IpAddress.parse(entry.address))
      .filter((ip) => ip.isUsable);
  }
}
