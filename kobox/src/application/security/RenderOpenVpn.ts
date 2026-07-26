import type { NetworkServicePort, VpnPkiPort } from '../../domain/security/ports.js';
import {
  VPN_VARIANTS,
  renderOpenVpnClientProfile,
  renderOpenVpnServer,
} from '../../domain/security/vpn.js';
import type { ManagedFilesPort, RenderedFile } from '../../domain/shared/files.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { SecuritySettings } from './settings.js';

export interface OpenVpnReport {
  readonly changedFiles: readonly string[];
  readonly profilesRendered: number;
  readonly skippedUsers: readonly string[];
}

interface Deps {
  readonly users: UserRepository;
  readonly pki: VpnPkiPort;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServicePort;
  readonly settings: SecuritySettings;
}

const SERVER_CONF_PREFIX = '/etc/openvpn/server/';

// Declarative render of the three server configs plus per-user client
// profiles. PKI material is read, never generated (Phase 4 provisions it):
// users without material are reported, not failed. No service restart here —
// restarting OpenVPN drops live tunnels, that stays an operator decision.
export class RenderOpenVpn {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<OpenVpnReport> {
    const { users, pki, files, settings } = this.deps;
    const rendered: RenderedFile[] = VPN_VARIANTS.map((variant) =>
      renderOpenVpnServer(variant, settings.vpn, pki.serverPaths()),
    );

    const skippedUsers: string[] = [];
    let profilesRendered = 0;
    const remote = settings.vpnRemote;
    if (remote !== undefined) {
      for (const user of await users.listAll()) {
        const material = await pki.clientMaterial(user.username);
        if (material === undefined) {
          skippedUsers.push(user.username.value);
          continue;
        }
        for (const variant of VPN_VARIANTS) {
          rendered.push(
            renderOpenVpnClientProfile(user.username, variant, remote, settings.vpn, material),
          );
          profilesRendered += 1;
        }
      }
    }

    const changedFiles = await files.apply(rendered);
    // Reload only when a server config actually changed (e.g. the CRL directive
    // was first added): a pure revocation republishes crl.pem, which each server
    // re-reads per client connect — no tunnel-dropping restart needed.
    if (changedFiles.some((path) => path.startsWith(SERVER_CONF_PREFIX))) {
      await this.deps.reload.reloadOpenVpn();
    }
    return { changedFiles, profilesRendered, skippedUsers };
  }
}
