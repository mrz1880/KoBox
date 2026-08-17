import { NEXTCLOUD_MOUNTS, type NextcloudPort } from '../../domain/installation/NextcloudPort.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
import type { Password } from '../../domain/user/Password.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { MailOutboxPort } from '../maintenance/MailOutboxPort.js';
import { UserNotFoundError } from './errors.js';

interface Deps {
  readonly repo: UserRepository;
  readonly credentials: PortalCredentialsPort;
  readonly nextcloud: NextcloudPort;
  readonly outbox: MailOutboxPort;
  readonly newPassword: () => Password;
  readonly clock: () => string;
}

function welcome(username: string, password: string): string {
  return [
    'Your Nextcloud account on the seedbox is ready.',
    '',
    `Username: ${username}`,
    `Password: ${password}`,
    '',
    'This password is only for Nextcloud. It is not the one you use on the',
    'portal, and changing one does not change the other. Change it from',
    'Nextcloud itself once you are in.',
    '',
    'Three folders are already there: rTorrent Complete, rTorrent Torrents and',
    'rTorrent Watch. Dropping a .torrent file into Watch is the same as putting',
    'it in the folder on the box.',
  ].join('\n');
}

// A member's Nextcloud account is created on request, not at signup. Nextcloud
// may not be installed at all, and a failure at account creation would be
// mistaken for KoBox being unable to create the account itself.
//
// The password is its own: KoBox holds the portal password only as a hash, so
// there is nothing to reuse, and inventing a shared one would be a lie about
// how the two systems relate.
export class ProvisionNextcloudAccount {
  constructor(private readonly deps: Deps) {}

  async execute(command: { username: Username }): Promise<void> {
    const user = await this.deps.repo.findByUsername(command.username);
    if (user === undefined) {
      throw new UserNotFoundError(command.username.value);
    }
    const password = this.deps.newPassword();
    await this.deps.nextcloud.ensureUser(user.username, password.reveal());
    for (const mount of NEXTCLOUD_MOUNTS) {
      await this.deps.nextcloud.ensureLocalMount(
        user.username,
        mount.label,
        `/home/${user.username.value}/${mount.under}`,
      );
    }
    // only the people who run the box administer Nextcloud, which is the whole
    // point of the arrangement: members see their files and nobody else's
    const credentials = await this.deps.credentials.find(user.username);
    await this.deps.nextcloud.setAdmin(user.username, credentials?.role === 'admin');
    await this.deps.outbox.enqueue(
      {
        recipient: user.email.value,
        subject: 'Your Nextcloud account on the seedbox',
        body: welcome(user.username.value, password.reveal()),
      },
      this.deps.clock(),
    );
  }
}
