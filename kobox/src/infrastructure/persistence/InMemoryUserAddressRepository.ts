import type { IpAddress } from '../../domain/shared/IpAddress.js';
import type { UserAddress, UserAddressRepository } from '../../domain/tracker/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryUserAddressRepository implements UserAddressRepository {
  private readonly entries = new Map<string, UserAddress>();

  listAll(): Promise<readonly UserAddress[]> {
    return Promise.resolve([...this.entries.values()]);
  }

  add(username: Username, ip: IpAddress): Promise<void> {
    this.entries.set(`${username.value}|${ip.value}`, { username, ip });
    return Promise.resolve();
  }

  remove(username: Username, ip: IpAddress): Promise<void> {
    this.entries.delete(`${username.value}|${ip.value}`);
    return Promise.resolve();
  }
}
