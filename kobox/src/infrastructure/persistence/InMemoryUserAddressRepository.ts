import type { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import type { DynDnsBinding, DynDnsBindingRepository } from '../../domain/security/ports.js';
import type { IpAddress } from '../../domain/shared/IpAddress.js';
import type { UserAddress, UserAddressRepository } from '../../domain/tracker/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryUserAddressRepository
  implements UserAddressRepository, DynDnsBindingRepository
{
  private readonly entries = new Map<string, UserAddress>();
  private readonly bindings = new Map<string, DynDnsBinding>();

  listAll(): Promise<readonly UserAddress[]> {
    const resolved = [...this.bindings.values()].flatMap((binding) =>
      binding.resolvedIp === undefined
        ? []
        : [{ username: binding.username, ip: binding.resolvedIp }],
    );
    return Promise.resolve([...this.entries.values(), ...resolved]);
  }

  add(username: Username, ip: IpAddress): Promise<void> {
    this.entries.set(`${username.value}|${ip.value}`, { username, ip });
    return Promise.resolve();
  }

  remove(username: Username, ip: IpAddress): Promise<void> {
    this.entries.delete(`${username.value}|${ip.value}`);
    return Promise.resolve();
  }

  listHostnames(): Promise<readonly DynDnsBinding[]> {
    return Promise.resolve([...this.bindings.values()]);
  }

  addHostname(username: Username, host: DynDnsHost): Promise<void> {
    const key = `${username.value}|${host.value}`;
    if (!this.bindings.has(key)) {
      this.bindings.set(key, { username, host });
    }
    return Promise.resolve();
  }

  removeHostname(username: Username, host: DynDnsHost): Promise<void> {
    this.bindings.delete(`${username.value}|${host.value}`);
    return Promise.resolve();
  }

  updateResolvedIp(username: Username, host: DynDnsHost, ip: IpAddress): Promise<void> {
    const key = `${username.value}|${host.value}`;
    const existing = this.bindings.get(key);
    if (existing) {
      this.bindings.set(key, { ...existing, resolvedIp: ip });
    }
    return Promise.resolve();
  }
}
