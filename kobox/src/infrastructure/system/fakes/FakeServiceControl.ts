import type { ServiceControlPort } from '../../../domain/user/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeServiceControl implements ServiceControlPort {
  private readonly running = new Set<string>();
  private readonly units = new Map<string, string>();
  private readonly restarts = new Map<string, number>();

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

  installUserService(username: Username, unitContent: string): Promise<void> {
    this.units.set(username.value, unitContent);
    return Promise.resolve();
  }

  removeUserService(username: Username): Promise<void> {
    this.units.delete(username.value);
    this.running.delete(username.value);
    return Promise.resolve();
  }

  restartUserService(username: Username): Promise<void> {
    this.restarts.set(username.value, (this.restarts.get(username.value) ?? 0) + 1);
    this.running.add(username.value);
    return Promise.resolve();
  }

  unitContentFor(username: Username): string | undefined {
    return this.units.get(username.value);
  }

  restartsFor(username: Username): number {
    return this.restarts.get(username.value) ?? 0;
  }
}
