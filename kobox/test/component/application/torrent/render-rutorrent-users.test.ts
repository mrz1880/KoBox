import { describe, expect, it } from 'vitest';
import { RenderRutorrentUsers } from '../../../../src/application/torrent/RenderRutorrentUsers.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNetworkServices } from '../../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeRutorrentProfiles } from '../../../../src/infrastructure/system/fakes/FakeRutorrentProfiles.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeRutorrentPools } from '../../../../src/infrastructure/system/fakes/FakeRutorrentPools.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

async function world() {
  const users = new InMemoryUserRepository();
  const files = new FakeRtorrentConfig();
  const reload = new FakeNetworkServices();
  await users.save(new UserBuilder().withUsername('alice').withScgiPort(51101).build());
  await users.save(
    new UserBuilder().withUsername('bob').withScgiPort(51102).withRtorrentPort(45001).build(),
  );
  const profiles = new FakeRutorrentProfiles();
  const pools = new FakeRutorrentPools();
  return {
    users,
    files,
    reload,
    profiles,
    pools,
    useCase: new RenderRutorrentUsers({ users, files, reload, profiles, pools }),
  };
}

describe('RenderRutorrentUsers', () => {
  // the folder where ruTorrent keeps a member's settings, and where it has the
  // member's own rTorrent leave the answer to its checks: theirs alone
  it('should_give_every_active_member_a_profile_folder_of_their_own', async () => {
    const { profiles, useCase } = await world();

    await useCase.execute();

    expect(profiles.ensured).toEqual(['alice', 'bob']);
  });

  // ruTorrent's eight alike groups said nothing: every member is offered
  // KoBox's, which keep a member's own choice once they made one
  it('should_offer_every_active_member_ratio_groups_that_say_what_they_do', async () => {
    const { profiles, useCase } = await world();

    await useCase.execute();

    expect(profiles.offeredRatioGroups).toEqual(['alice', 'bob']);
  });

  // ruTorrent's PHP runs as each member, so a flaw in it reaches that
  // member's files and nobody else's; a suspended member keeps no pool
  it('should_run_rutorrent_as_each_active_member_and_nobody_else', async () => {
    const { users, pools, useCase } = await world();
    await users.save(new UserBuilder().withUsername('carol').withScgiPort(51103).withRtorrentPort(45002).suspended());

    await useCase.execute();

    expect(pools.converged.map((pool) => pool.path)).toEqual([
      '/etc/php/8.4/fpm/pool.d/kobox-ru-alice.conf',
      '/etc/php/8.4/fpm/pool.d/kobox-ru-bob.conf',
    ]);
  });

  it('should_render_the_rpc_include_and_a_config_per_user', async () => {
    const { files, useCase } = await world();

    await useCase.execute();

    const include = files.contentAt('/etc/nginx/kobox.d/rutorrent-users.conf');
    expect(include).toContain('location = /RPC-ALICE');
    expect(include).toContain('scgi_pass 127.0.0.1:51101;');
    expect(include).toContain('location = /RPC-BOB');
    expect(files.contentAt('/var/www/rutorrent/conf/users/alice/config.php')).toContain(
      '$scgi_port = 51101;',
    );
    expect(files.contentAt('/var/www/rutorrent/conf/users/bob/config.php')).toContain(
      '$scgi_port = 51102;',
    );
  });

  it('should_reload_nginx_after_writing', async () => {
    const { reload, useCase } = await world();

    await useCase.execute();

    expect(reload.reloads).toContain('nginx');
  });

  it('should_skip_suspended_users_from_the_rpc_mounts', async () => {
    const users = new InMemoryUserRepository();
    const files = new FakeRtorrentConfig();
    const reload = new FakeNetworkServices();
    await users.save(new UserBuilder().withUsername('alice').withScgiPort(51101).suspended());
    const profiles = new FakeRutorrentProfiles();
    const useCase = new RenderRutorrentUsers({ users, files, reload, profiles, pools: new FakeRutorrentPools() });

    await useCase.execute();

    expect(files.contentAt('/etc/nginx/kobox.d/rutorrent-users.conf')).not.toContain(
      'location = /RPC-ALICE',
    );
  });
});
