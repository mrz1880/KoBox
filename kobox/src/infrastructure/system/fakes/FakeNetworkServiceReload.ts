import type { NetworkServiceReloadPort } from '../../../domain/tracker/ports.js';

export class FakeNetworkServiceReload implements NetworkServiceReloadPort {
  dnsReloads = 0;

  reloadDns(): Promise<void> {
    this.dnsReloads += 1;
    return Promise.resolve();
  }
}
