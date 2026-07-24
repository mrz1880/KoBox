import type { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import type { DynDnsBindingRepository } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';

export interface HostnameDirtyReport {
  readonly whitelistDirty: boolean;
  readonly firewallDirty: boolean;
  readonly fail2banDirty: boolean;
}

export interface ManageUserHostnameInput {
  readonly action: 'add' | 'remove';
  readonly username: Username;
  readonly host: DynDnsHost;
}

interface Deps {
  readonly bindings: DynDnsBindingRepository;
}

// DynDNS bindings enter here; the effective address set only changes when a
// RESOLVED binding disappears — an add contributes nothing until the first
// successful resolution (resolve-dyndns owns that transition).
export class ManageUserHostname {
  constructor(private readonly deps: Deps) {}

  async execute(input: ManageUserHostnameInput): Promise<HostnameDirtyReport> {
    const { bindings } = this.deps;
    if (input.action === 'add') {
      await bindings.addHostname(input.username, input.host);
      return { whitelistDirty: false, firewallDirty: false, fail2banDirty: false };
    }
    const existing = (await bindings.listHostnames()).find(
      (binding) =>
        binding.username.equals(input.username) && binding.host.equals(input.host),
    );
    await bindings.removeHostname(input.username, input.host);
    const dirty = existing?.resolvedIp !== undefined;
    return { whitelistDirty: dirty, firewallDirty: dirty, fail2banDirty: dirty };
  }
}
