import type { AccountIds, UserIdentityPort } from '../../../domain/security/ports.js';
import type { Username } from '../../../domain/user/Username.js';

// A member's gid follows their uid, as useradd's own per-user group does.
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

  idsOf(username: Username): Promise<AccountIds | undefined> {
    const uid = this.uids.get(username.value);
    return Promise.resolve(uid === undefined ? undefined : { uid, gid: uid });
  }
}
