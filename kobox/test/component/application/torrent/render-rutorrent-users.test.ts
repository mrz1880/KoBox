import { describe, expect, it } from 'vitest';
import { RenderRutorrentUsers } from '../../../../src/application/torrent/RenderRutorrentUsers.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNetworkServices } from '../../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeRutorrentProfiles } from '../../../../src/infrastructure/system/fakes/FakeRutorrentProfiles.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
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
  return {
    users,
    files,
    reload,
    profiles,
    useCase: new RenderRutorrentUsers({ users, files, reload, profiles }),
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
    const useCase = new RenderRutorrentUsers({ users, files, reload, profiles });

    await useCase.execute();

    expect(files.contentAt('/etc/nginx/kobox.d/rutorrent-users.conf')).not.toContain(
      'location = /RPC-ALICE',
    );
  });
});
