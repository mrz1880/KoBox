import type { ServiceControlPort } from '../../../domain/user/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeServiceControl implements ServiceControlPort {
  private readonly running = new Set<string>();

  startUserService(username: Username): Promise<void> {
    this.running.add(username.value);
    return Promise.resolve();
  }

  stopUserService(username: Username): Promise<void> {
    this.running.delete(username.value);
    return Promise.resolve();
  }

  isUserServiceRunning(username: Username): Promise<boolean> {
    return Promise.resolve(this.running.has(username.value));
  }
}
