import { beforeEach, describe, expect, it } from 'vitest';
import { RenderFail2ban } from '../../../../src/application/security/RenderFail2ban.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryUserAddressRepository } from '../../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { FakeNetworkServices } from '../../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { testSettings } from './firewall.test.js';

let addresses: InMemoryUserAddressRepository;
let files: FakeRtorrentConfig;
let reload: FakeNetworkServices;
let useCase: RenderFail2ban;

beforeEach(() => {
  addresses = new InMemoryUserAddressRepository();
  files = new FakeRtorrentConfig();
  reload = new FakeNetworkServices();
  useCase = new RenderFail2ban({ addresses, files, reload, settings: testSettings });
});

describe('RenderFail2ban', () => {
  it('should_render_jails_with_user_addresses_in_ignoreip_and_reload', async () => {
    await addresses.add(Username.parse('alice'), IpAddress.parse('198.51.100.7'));

    await useCase.execute();

    const jail = files.contentAt('/etc/fail2ban/jail.d/kobox.local');
    expect(jail).toContain('ignoreip = 127.0.0.1/8 ::1 198.51.100.7');
    expect(jail).toContain('[kobox-publickey-flood]');
    expect(files.contentAt('/etc/fail2ban/filter.d/kobox-publickey-flood.conf')).toContain(
      'Accepted publickey',
    );
    expect(reload.reloads).toEqual(['fail2ban']);
  });

  it('should_not_reload_when_nothing_changed', async () => {
    await useCase.execute();
    await useCase.execute();

    expect(reload.reloads).toEqual(['fail2ban']); // once, not twice
  });
});
