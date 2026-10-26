import type {
  NextcloudPort,
  NextcloudSystemValue,
} from '../../../domain/installation/NextcloudPort.js';
import type { Password } from '../../../domain/user/Password.js';
import type { Username } from '../../../domain/user/Username.js';

// Records what occ would have been asked to do. Starts uninstalled, because
// that is the state a fresh box is in and the one the installer has to handle.
export class FakeNextcloud implements NextcloudPort {
  private installed = false;
  readonly enabledApps: string[] = [];
  readonly users: string[] = [];
  private readonly passwords = new Map<string, string>();
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

  servedAt: { host: string; port: number } | undefined;

  serveAt(address: { readonly host: string; readonly port: number }): Promise<void> {
    this.servedAt = { host: address.host, port: address.port };
    return Promise.resolve();
  }

  // the server variable Nextcloud was told to open sessions from
  portalSignIn: string | undefined;

  trustPortalSignIn(variable: string): Promise<void> {
    this.portalSignIn = variable;
    return Promise.resolve();
  }

  readonly disabledApps: string[] = [];

  disableApp(app: string): Promise<void> {
    this.disabledApps.push(app);
    return Promise.resolve();
  }

  readonly systemValues = new Map<string, string>();

  setSystemValues(values: readonly NextcloudSystemValue[]): Promise<void> {
    for (const { key, value } of values) {
      this.systemValues.set(key, value);
    }
    return Promise.resolve();
  }

  enableApp(app: string): Promise<void> {
    this.enabledApps.push(app);
    return Promise.resolve();
  }

  hasUser(username: Username): Promise<boolean> {
    return Promise.resolve(this.users.includes(username.value));
  }

  setUserPassword(username: Username, password: Password): Promise<void> {
    if (!this.users.includes(username.value)) {
      this.users.push(username.value);
    }
    this.passwords.set(username.value, password.reveal());
    return Promise.resolve();
  }

  passwordOf(username: Username): string | undefined {
    return this.passwords.get(username.value);
  }

  deleteUser(username: Username): Promise<void> {
    const index = this.users.indexOf(username.value);
    if (index !== -1) {
      this.deleted.push(username.value);
      this.users.splice(index, 1);
      this.passwords.delete(username.value);
    }
    return Promise.resolve();
  }

  setAdmin(username: Username, admin: boolean): Promise<void> {
    // occ group:adduser fails on an account Nextcloud does not know
    if (!this.users.includes(username.value)) {
      return Promise.reject(new Error(`occ: user ${username.value} not found`));
    }
    this.admins.set(username.value, admin);
    return Promise.resolve();
  }

  ensureLocalMount(username: Username, label: string, absolutePath: string): Promise<void> {
    this.mounts.push({ username: username.value, label, path: absolutePath });
    return Promise.resolve();
  }
}
