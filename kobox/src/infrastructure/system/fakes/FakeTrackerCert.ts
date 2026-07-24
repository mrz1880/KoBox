import type { TrackerHost } from '../../../domain/tracker/TrackerHost.js';
import type { TrackerPort } from '../../../domain/tracker/TrackerPort.js';
import type { FetchedCert, TrackerCertPort } from '../../../domain/tracker/ports.js';

export class FakeTrackerCert implements TrackerCertPort {
  private readonly certs = new Map<string, FetchedCert>();
  readonly fetchedHosts: string[] = [];

  givenCert(host: string, cert: FetchedCert): void {
    this.certs.set(host, cert);
  }

  fetch(host: TrackerHost, _port: TrackerPort): Promise<FetchedCert | undefined> {
    this.fetchedHosts.push(host.value);
    return Promise.resolve(this.certs.get(host.value));
  }
}
