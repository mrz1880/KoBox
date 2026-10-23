import { beforeEach, describe, expect, it } from 'vitest';
import { ChangeRole } from '../../../../src/application/user/ChangeRole.js';
import { PortalLoginMissingError, UserNotFoundError } from '../../../../src/application/user/errors.js';
import { ComponentName } from '../../../../src/domain/installation/ComponentName.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { EmailAddress } from '../../../../src/domain/user/EmailAddress.js';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { ProxyPort, RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { SeedboxUser } from '../../../../src/domain/user/SeedboxUser.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryComponentRegistry } from '../../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNextcloud } from '../../../../src/infrastructure/system/fakes/FakeNextcloud.js';

const alice = Username.parse('alice');
const aHash = HashedPassword.parse('$6$testsalt$0123456789abcdefghijklmnopqrstuv');
const now = '2026-10-23 10:00:00';

let repo: InMemoryUserRepository;
let credentials: InMemoryPortalCredentialsRepository;
let components: InMemoryComponentRegistry;
let nextcloud: FakeNextcloud;
let changeRole: ChangeRole;

beforeEach(async () => {
  repo = new InMemoryUserRepository();
  credentials = new InMemoryPortalCredentialsRepository();
  components = new InMemoryComponentRegistry();
  nextcloud = new FakeNextcloud();
  changeRole = new ChangeRole({ repo, credentials, components, nextcloud, clock: () => now });
  await repo.save(
    SeedboxUser.create({
      username: alice,
      email: EmailAddress.parse('alice@example.org'),
      quota: Quota.gib(412),
      proxyPort: ProxyPort.parse(8080),
      scgiPort: ScgiPort.parse(51101),
      rtorrentPort: RtorrentPort.parse(45000),
    }).user,
  );
});

describe('ChangeRole', () => {
  it('should_promote_a_member_and_keep_the_rest_of_their_portal_login', async () => {
    await credentials.save(
      { username: alice, passwordHash: aHash, role: 'user', appTokenHash: 'abc', language: Language.fr },
      now,
    );

    await changeRole.execute({ username: alice, role: 'admin' });

    expect(await credentials.find(alice)).toEqual({
      username: alice,
      passwordHash: aHash,
      role: 'admin',
      appTokenHash: 'abc',
      language: Language.fr,
    });
  });

  it('should_refuse_an_account_that_does_not_exist', async () => {
    await expect(
      changeRole.execute({ username: Username.parse('bob'), role: 'admin' }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('should_refuse_a_member_who_has_no_portal_login_yet', async () => {
    await expect(changeRole.execute({ username: alice, role: 'admin' })).rejects.toBeInstanceOf(
      PortalLoginMissingError,
    );
  });

  it('should_take_a_demoted_member_out_of_the_nextcloud_admins', async () => {
    await credentials.save({ username: alice, passwordHash: aHash, role: 'admin' }, now);
    await components.markInstalled(ComponentName.parse('nextcloud'), undefined, now);
    await nextcloud.ensureUser(alice);
    await nextcloud.setAdmin(alice, true);

    await changeRole.execute({ username: alice, role: 'user' });

    expect(nextcloud.admins.get('alice')).toBe(false);
  });

  it('should_leave_nextcloud_alone_for_a_member_who_never_asked_for_an_account', async () => {
    await credentials.save({ username: alice, passwordHash: aHash, role: 'user' }, now);
    await components.markInstalled(ComponentName.parse('nextcloud'), undefined, now);

    await changeRole.execute({ username: alice, role: 'admin' });

    expect((await credentials.find(alice))?.role).toBe('admin');
    expect(nextcloud.admins.has('alice')).toBe(false);
  });
});
