import type { IpAddress } from '../../domain/shared/IpAddress.js';
import type { UserAddressRepository } from '../../domain/tracker/ports.js';
import type { Username } from '../../domain/user/Username.js';

export interface ManageUserAddressCommand {
  readonly action: 'add' | 'remove';
  readonly username: Username;
  readonly ip: IpAddress;
}

export interface UserAddressReport {
  readonly whitelistDirty: boolean;
}

interface Deps {
  readonly addresses: UserAddressRepository;
}

export class ManageUserAddress {
  constructor(private readonly deps: Deps) {}

  async execute(command: ManageUserAddressCommand): Promise<UserAddressReport> {
    if (command.action === 'add') {
      await this.deps.addresses.add(command.username, command.ip);
    } else {
      await this.deps.addresses.remove(command.username, command.ip);
    }
    return { whitelistDirty: true };
  }
}
