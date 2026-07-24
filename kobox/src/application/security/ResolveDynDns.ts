import type {
  DynDnsBindingRepository,
  DynDnsResolverPort,
  SecurityNotificationPort,
} from '../../domain/security/ports.js';

export interface ResolveDynDnsReport {
  readonly changed: number;
  readonly unresolved: number;
  readonly whitelistDirty: boolean;
  readonly firewallDirty: boolean;
  readonly fail2banDirty: boolean;
}

interface Deps {
  readonly bindings: DynDnsBindingRepository;
  readonly resolver: DynDnsResolverPort;
  readonly notifications: SecurityNotificationPort;
}

// The DynamicAddressResolver replacement: re-resolve every hostname binding;
// on change, record the new address, notify, and report dirty so the worker
// chains whitelist + firewall + fail2ban refreshes. Resolution failure keeps
// the last known address — a flapping dyndns must never evict a user.
export class ResolveDynDns {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<ResolveDynDnsReport> {
    const { bindings, resolver, notifications } = this.deps;
    let changed = 0;
    let unresolved = 0;

    for (const binding of await bindings.listHostnames()) {
      const ip = await resolver.resolve(binding.host);
      if (ip === undefined) {
        unresolved += 1;
        continue;
      }
      if (binding.resolvedIp?.equals(ip) === true) {
        continue;
      }
      await bindings.updateResolvedIp(binding.username, binding.host, ip);
      await notifications.notify({
        type: 'DynDnsAddressChanged',
        username: binding.username.value,
        host: binding.host.value,
        ...(binding.resolvedIp !== undefined && { oldIp: binding.resolvedIp.value }),
        newIp: ip.value,
      });
      changed += 1;
    }

    const dirty = changed > 0;
    return {
      changed,
      unresolved,
      whitelistDirty: dirty,
      firewallDirty: dirty,
      fail2banDirty: dirty,
    };
  }
}
