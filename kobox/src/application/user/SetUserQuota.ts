import type { Quota } from '../../domain/user/Quota.js';
import type { QuotaPort, UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { UserNotFoundError } from './errors.js';

export interface SetUserQuotaCommand {
  readonly username: Username;
  readonly quota: Quota;
}

interface Deps {
  readonly repo: UserRepository;
  readonly quota: QuotaPort;
}

// Moves one member's allowance. Nothing here reads or writes anybody else's:
// a quota is per-account, and the only reason to say so is that the report
// which prompted this feature described the opposite.
export class SetUserQuota {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetUserQuotaCommand): Promise<void> {
    const user = await this.deps.repo.findByUsername(command.username);
    if (user === undefined) {
      throw new UserNotFoundError(command.username.value);
    }
    // the filesystem first: if setquota fails, the recorded allowance still
    // matches what the disk enforces
    await this.deps.quota.setQuota(user.username, command.quota);
    await this.deps.repo.save(user.withQuota(command.quota));
  }
}
