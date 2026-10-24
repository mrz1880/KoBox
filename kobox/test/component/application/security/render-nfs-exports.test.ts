import { describe, expect, it } from 'vitest';
import { RenderNfsExports } from '../../../../src/application/security/RenderNfsExports.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryUserAddressRepository } from '../../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNetworkServices } from '../../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeUserIdentity } from '../../../../src/infrastructure/system/fakes/FakeUserIdentity.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';
import { testSettings } from './firewall.test.js';

async function world() {
  const users = new InMemoryUserRepository();
  const addresses = new InMemoryUserAddressRepository();
  const files = new FakeRtorrentConfig();
  const reload = new FakeNetworkServices();
  const identity = new FakeUserIdentity();
  identity.setUid('alice', 1008);
  await users.save(new UserBuilder().withUsername('alice').build());
  await addresses.add(Username.parse('alice'), IpAddress.parse('203.0.113.9'));
  return {
    users,
    addresses,
    files,
    reload,
    useCase: new RenderNfsExports({ users, addresses, files, reload, identity, settings: testSettings }),
  };
}

describe('RenderNfsExports', () => {
  it('should_export_a_home_to_its_member_in_every_tunnel_and_to_their_trusted_addresses', async () => {
    const { files, useCase } = await world();

    await useCase.execute();

    const options = 'rw,sync,no_subtree_check,all_squash,anonuid=1008,anongid=1008';
    const lines = (files.contentAt('/etc/exports.d/kobox.exports') ?? '').split('\n');
    // alice was the first member saved: host 2 in each tunnel
    for (const client of ['10.0.0.2', '10.0.1.2', '10.0.2.2', '203.0.113.9']) {
      expect(lines).toContain(`/home/alice ${client}(${options})`);
    }
    // and nowhere else: no subnet, no wildcard
    expect(lines.filter((line) => line.startsWith('/home/alice '))).toHaveLength(4);
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
    const identity = new FakeUserIdentity();
    identity.setUid('alice', 1008);
    await users.save(new UserBuilder().withUsername('alice').suspended());
    await addresses.add(Username.parse('alice'), IpAddress.parse('203.0.113.9'));
    const useCase = new RenderNfsExports({ users, addresses, files, reload, identity, settings: testSettings });

    await useCase.execute();

    expect(files.contentAt('/etc/exports.d/kobox.exports')).not.toContain('/home/alice');
  });

  it('should_export_nothing_for_a_member_whose_system_account_is_gone', async () => {
    const users = new InMemoryUserRepository();
    const files = new FakeRtorrentConfig();
    await users.save(new UserBuilder().withUsername('alice').build());
    const useCase = new RenderNfsExports({
      users,
      addresses: new InMemoryUserAddressRepository(),
      files,
      reload: new FakeNetworkServices(),
      identity: new FakeUserIdentity(),
      settings: testSettings,
    });

    await useCase.execute();

    expect(files.contentAt('/etc/exports.d/kobox.exports')).not.toContain('/home/alice');
  });
});

