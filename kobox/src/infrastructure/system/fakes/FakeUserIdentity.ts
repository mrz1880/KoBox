import type { UserIdentityPort } from '../../../domain/security/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeUserIdentity implements UserIdentityPort {
  private readonly uids = new Map<string, number>();

  setUid(username: string, uid: number): void {
    this.uids.set(username, uid);
  }

  clearUid(username: string): void {
    this.uids.delete(username);
  }

  uidOf(username: Username): Promise<number | undefined> {
    return Promise.resolve(this.uids.get(username.value));
  }
}
