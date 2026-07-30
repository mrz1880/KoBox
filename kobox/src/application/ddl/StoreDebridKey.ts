import type { DebridAccountRepository } from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';

export interface StoreDebridKeyCommand {
  readonly username: Username;
  // already sealed by the portal: the plaintext key never reaches a job payload
  readonly encryptedKey: string;
}

interface Deps {
  readonly accounts: DebridAccountRepository;
  readonly clock: () => string;
}

// The worker step: persist the user's sealed key (upsert — a new key replaces
// the old). It never opens the ciphertext; only a download start needs to.
export class StoreDebridKey {
  constructor(private readonly deps: Deps) {}

  async execute(command: StoreDebridKeyCommand): Promise<void> {
    await this.deps.accounts.save(command.username, command.encryptedKey, this.deps.clock());
  }
}

export interface ClearDebridKeyCommand {
  readonly username: Username;
}

// Dropping the account is the user's own privacy affordance; delete-user does
// the same for a removed account so no stale secret survives it.
export class ClearDebridKey {
  constructor(private readonly deps: Pick<Deps, 'accounts'>) {}

  async execute(command: ClearDebridKeyCommand): Promise<void> {
    await this.deps.accounts.remove(command.username);
  }
}
