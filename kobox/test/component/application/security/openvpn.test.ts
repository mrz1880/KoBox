import { beforeEach, describe, expect, it } from 'vitest';
import { RenderOpenVpn } from '../../../../src/application/security/RenderOpenVpn.js';
import { DynDnsHost } from '../../../../src/domain/security/DynDnsHost.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNetworkServices } from '../../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeVpnPki } from '../../../../src/infrastructure/system/fakes/FakeVpnPki.js';
import { aUser } from '../../../builders/UserBuilder.js';
import { testSettings } from './firewall.test.js';

const material = {
  caCrt: 'CA-PEM',
  userCrt: 'ALICE-PEM',
  userKey: 'ALICE-KEY',
};

let users: InMemoryUserRepository;
let pki: FakeVpnPki;
let files: FakeRtorrentConfig;
let reload: FakeNetworkServices;

function useCase(withRemote: boolean): RenderOpenVpn {
  return new RenderOpenVpn({
    users,
    pki,
    files,
    reload,
    settings: withRemote
      ? { ...testSettings, vpnRemote: DynDnsHost.parse('seedbox.example.org') }
      : testSettings,
  });
}

beforeEach(() => {
  users = new InMemoryUserRepository();
  pki = new FakeVpnPki();
  files = new FakeRtorrentConfig();
  reload = new FakeNetworkServices();
});

describe('RenderOpenVpn', () => {
  it('should_render_the_three_server_configs_without_compression', async () => {
    await useCase(true).execute();

    for (const variant of ['tun-gw', 'tun', 'tap']) {
      const content = files.contentAt(`/etc/openvpn/server/kobox-${variant}.conf`);
      expect(content).toBeDefined();
      expect(content).not.toContain('comp-lzo');
    }
  });

  it('should_render_profiles_for_users_with_pki_material_and_report_the_rest', async () => {
    await users.save(aUser().build());
    await users.save(aUser().withUsername('bob').withScgiPort(51102).withRtorrentPort(45001).build());
    pki.setMaterial('alice', material);

    const report = await useCase(true).execute();

    expect(files.contentAt('/etc/kobox/vpn-profiles/alice/kobox-tun-gw.ovpn')).toContain(
      'remote seedbox.example.org 8193',
    );
    expect(files.contentAt('/etc/kobox/vpn-profiles/alice/kobox-tap.ovpn')).toContain('dev tap');
    expect(files.contentAt('/etc/kobox/vpn-profiles/bob/kobox-tun-gw.ovpn')).toBeUndefined();
    expect(report.skippedUsers).toEqual(['bob']);
  });

  it('should_reload_openvpn_when_a_server_config_changed', async () => {
    // a fresh render writes the three server configs (the CRL directive lands
    // here) — the servers must reload to pick it up
    await useCase(true).execute();

    expect(reload.reloads).toContain('openvpn');
  });

  it('should_not_reload_openvpn_when_nothing_changed', async () => {
    const uc = useCase(true);
    await uc.execute();
    reload.reloads.length = 0;

    // a converged re-render changes no server config: no tunnel-dropping reload
    await uc.execute();

    expect(reload.reloads).not.toContain('openvpn');
  });

  it('should_skip_all_profiles_when_no_vpn_remote_is_configured', async () => {
    await users.save(aUser().build());
    pki.setMaterial('alice', material);

    const report = await useCase(false).execute();

    expect(files.contentAt('/etc/openvpn/server/kobox-tun.conf')).toBeDefined();
    expect(files.contentAt('/etc/kobox/vpn-profiles/alice/kobox-tun-gw.ovpn')).toBeUndefined();
    expect(report.skippedUsers).toEqual([]);
    expect(report.profilesRendered).toBe(0);
  });
});
