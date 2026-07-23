import type { SftpPort } from '../../../domain/user/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeSftp implements SftpPort {
  private readonly enabled = new Set<string>();

  enableChrootAccess(username: Username): Promise<void> {
    this.enabled.add(username.value);
    return Promise.resolve();
  }

  disableChrootAccess(username: Username): Promise<void> {
    this.enabled.delete(username.value);
    return Promise.resolve();
  }

  isChrootAccessEnabled(username: Username): Promise<boolean> {
    return Promise.resolve(this.enabled.has(username.value));
  }
}
