import { describe, expect, it } from 'vitest';
import { RenderNfsExports } from '../../../../src/application/security/RenderNfsExports.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryUserAddressRepository } from '../../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNetworkServices } from '../../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

async function world() {
  const users = new InMemoryUserRepository();
  const addresses = new InMemoryUserAddressRepository();
  const files = new FakeRtorrentConfig();
  const reload = new FakeNetworkServices();
  await users.save(new UserBuilder().withUsername('alice').build());
  await addresses.add(Username.parse('alice'), IpAddress.parse('203.0.113.9'));
  return {
    users,
    addresses,
    files,
    reload,
    useCase: new RenderNfsExports({ users, addresses, files, reload }),
  };
}

describe('RenderNfsExports', () => {
  it('should_render_per_user_home_exports_scoped_to_trusted_addresses', async () => {
    const { files, useCase } = await world();

    await useCase.execute();

    expect(files.contentAt('/etc/exports.d/kobox.exports')).toContain(
      '/home/alice 203.0.113.9(rw,sync,no_subtree_check,root_squash)',
    );
  });

  it('should_reload_the_exports_after_writing', async () => {
    const { reload, useCase } = await world();

    await useCase.execute();

    expect(reload.reloads).toContain('nfs');
  });

  it('should_omit_suspended_users', async () => {
    const users = new InMemoryUserRepository();
    const addresses = new InMemoryUserAddressRepository();
    const files = new FakeRtorrentConfig();
    const reload = new FakeNetworkServices();
    await users.save(new UserBuilder().withUsername('alice').suspended());
    await addresses.add(Username.parse('alice'), IpAddress.parse('203.0.113.9'));
    const useCase = new RenderNfsExports({ users, addresses, files, reload });

    await useCase.execute();

    expect(files.contentAt('/etc/exports.d/kobox.exports')).not.toContain('/home/alice');
  });
});
