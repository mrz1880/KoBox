import type { NetworkServiceReloadPort } from '../../../domain/tracker/ports.js';

export class FakeNetworkServiceReload implements NetworkServiceReloadPort {
  dnsReloads = 0;
  peerGuardianReloads = 0;

  reloadDns(): Promise<void> {
    this.dnsReloads += 1;
    return Promise.resolve();
  }

  reloadPeerGuardian(): Promise<void> {
    this.peerGuardianReloads += 1;
    return Promise.resolve();
  }
}
