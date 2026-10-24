import { beforeEach, describe, expect, it } from 'vitest';
import { NextcloudLogin } from '../../../../src/application/user/NextcloudLogin.js';
import { WhenInstalled } from '../../../../src/application/user/WhenInstalled.js';
import { ComponentName } from '../../../../src/domain/installation/ComponentName.js';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { homeOf } from '../../../../src/domain/user/homeDirectory.js';
import { InMemoryComponentRegistry } from '../../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { FakeNextcloud } from '../../../../src/infrastructure/system/fakes/FakeNextcloud.js';
import { FakeServiceLogin } from '../../../../src/infrastructure/system/fakes/FakeServiceLogin.js';

const alice = Username.parse('alice');
const aHash = HashedPassword.parse('$6$testsalt$0123456789abcdefghijklmnopqrstuv');
const first = Password.parse('correct horse battery');
const now = '2026-10-24 10:00:00';

let credentials: InMemoryPortalCredentialsRepository;
let nextcloud: FakeNextcloud;
let login: NextcloudLogin;

beforeEach(async () => {
  credentials = new InMemoryPortalCredentialsRepository();
  nextcloud = new FakeNextcloud();
  login = new NextcloudLogin({ nextcloud, credentials });
  await credentials.save({ username: alice, passwordHash: aHash, role: 'user' }, now);
});

describe('NextcloudLogin', () => {
  it('should_open_an_account_with_the_three_folders_on_the_first_password', async () => {
    await login.setPassword(alice, first);

    expect(nextcloud.passwordOf(alice)).toBe(first.reveal());
    expect(nextcloud.mounts).toEqual([
      { username: 'alice', label: 'rTorrent Complete', path: `${homeOf(alice)}/rtorrent/complete` },
      { username: 'alice', label: 'rTorrent Torrents', path: `${homeOf(alice)}/rtorrent/torrents` },
      { username: 'alice', label: 'rTorrent Watch', path: `${homeOf(alice)}/rtorrent/watch` },
    ]);
    expect(nextcloud.admins.get('alice')).toBe(false);
  });

  it('should_make_an_admin_of_the_box_an_admin_of_nextcloud', async () => {
    await credentials.save({ username: alice, passwordHash: aHash, role: 'admin' }, now);

    await login.setPassword(alice, first);

    expect(nextcloud.admins.get('alice')).toBe(true);
  });

  it('should_change_the_password_of_an_account_that_exists', async () => {
    await login.setPassword(alice, first);
    const second = Password.parse('a brand new one');

    await login.setPassword(alice, second);

    expect(nextcloud.passwordOf(alice)).toBe(second.reveal());
  });

  it('should_delete_the_account_and_accept_one_that_is_already_gone', async () => {
    await login.setPassword(alice, first);

    await login.remove(alice);
    await login.remove(alice);

    expect(await nextcloud.hasUser(alice)).toBe(false);
  });
});

describe('WhenInstalled', () => {
  let components: InMemoryComponentRegistry;
  let inner: FakeServiceLogin;
  let gated: WhenInstalled;

  beforeEach(() => {
    components = new InMemoryComponentRegistry();
    inner = new FakeServiceLogin();
    gated = new WhenInstalled(ComponentName.parse('samba'), components, inner);
  });

  it('should_leave_a_service_that_is_not_installed_alone', async () => {
    await gated.setPassword(alice, first);

    expect(inner.passwordOf(alice)).toBeUndefined();
  });

  it('should_hand_the_password_to_a_service_that_is_installed', async () => {
    await components.markInstalled(ComponentName.parse('samba'), undefined, now);

    await gated.setPassword(alice, first);
    expect(inner.passwordOf(alice)).toBe(first.reveal());

    await gated.remove(alice);
    expect(inner.passwordOf(alice)).toBeUndefined();
  });
});
