import type { NextcloudPort } from '../../../domain/installation/NextcloudPort.js';
import type { Username } from '../../../domain/user/Username.js';

// Records what occ would have been asked to do. Starts uninstalled, because
// that is the state a fresh box is in and the one the installer has to handle.
export class FakeNextcloud implements NextcloudPort {
  private installed = false;
  readonly enabledApps: string[] = [];
  readonly users: string[] = [];
  readonly deleted: string[] = [];
  readonly admins = new Map<string, boolean>();
  readonly mounts: { username: string; label: string; path: string }[] = [];

  isInstalled(): Promise<boolean> {
    return Promise.resolve(this.installed);
  }

  install(): Promise<void> {
    this.installed = true;
    return Promise.resolve();
  }

  enableApp(app: string): Promise<void> {
    this.enabledApps.push(app);
    return Promise.resolve();
  }

  ensureUser(username: Username): Promise<void> {
    if (!this.users.includes(username.value)) {
      this.users.push(username.value);
    }
    return Promise.resolve();
  }

  deleteUser(username: Username): Promise<void> {
    this.deleted.push(username.value);
    this.users.splice(this.users.indexOf(username.value), 1);
    return Promise.resolve();
  }

  setAdmin(username: Username, admin: boolean): Promise<void> {
    this.admins.set(username.value, admin);
    return Promise.resolve();
  }

  ensureLocalMount(username: Username, label: string, absolutePath: string): Promise<void> {
    this.mounts.push({ username: username.value, label, path: absolutePath });
    return Promise.resolve();
  }
}
