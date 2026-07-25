import type { IpsetPort } from '../../../domain/tracker/ports.js';

export class FakeIpset implements IpsetPort {
  supported = true;
  ensured = 0;
  readonly restored: string[] = [];

  ensureBlocklistSet(): Promise<boolean> {
    this.ensured += 1;
    return Promise.resolve(this.supported);
  }

  restore(filePath: string): Promise<void> {
    if (!this.supported) {
      return Promise.reject(new Error('ipset restore on unsupported host'));
    }
    this.restored.push(filePath);
    return Promise.resolve();
  }
}
