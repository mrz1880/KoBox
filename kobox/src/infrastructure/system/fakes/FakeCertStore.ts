import type { TrackerHost } from '../../../domain/tracker/TrackerHost.js';
import type { CertStorePort } from '../../../domain/tracker/ports.js';

export class FakeCertStore implements CertStorePort {
  readonly installed = new Map<string, string>();
  rehashCount = 0;

  install(host: TrackerHost, pem: string): Promise<void> {
    this.installed.set(host.value, pem);
    return Promise.resolve();
  }

  remove(host: TrackerHost): Promise<void> {
    this.installed.delete(host.value);
    return Promise.resolve();
  }

  rehash(): Promise<void> {
    this.rehashCount += 1;
    return Promise.resolve();
  }
}
