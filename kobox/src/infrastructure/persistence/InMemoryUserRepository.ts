import type { SeedboxUser } from '../../domain/user/SeedboxUser.js';
import { UserId } from '../../domain/user/UserId.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, SeedboxUser>();
  private nextId = 1;

  findByUsername(username: Username): Promise<SeedboxUser | undefined> {
    return Promise.resolve(this.users.get(username.value));
  }

  listAll(): Promise<readonly SeedboxUser[]> {
    return Promise.resolve([...this.users.values()]);
  }

  save(user: SeedboxUser): Promise<SeedboxUser> {
    const identified = user.id ? user : user.identifiedBy(UserId.parse(this.nextId++));
    this.users.set(identified.username.value, identified);
    return Promise.resolve(identified);
  }

  delete(username: Username): Promise<void> {
    this.users.delete(username.value);
    return Promise.resolve();
  }
}
