import type { PortalCredentials, PortalCredentialsPort } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryPortalCredentialsRepository implements PortalCredentialsPort {
  private readonly rows = new Map<string, PortalCredentials>();

  find(username: Username): Promise<PortalCredentials | undefined> {
    return Promise.resolve(this.rows.get(username.value));
  }

  save(credentials: PortalCredentials, _now: string): Promise<void> {
    this.rows.set(credentials.username.value, credentials);
    return Promise.resolve();
  }

  delete(username: Username): Promise<void> {
    this.rows.delete(username.value);
    return Promise.resolve();
  }
}
