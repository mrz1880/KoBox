import type { SeedRuleRepository } from '../../domain/space/ports.js';
import type { SeedRule } from '../../domain/space/SeedRule.js';

interface Deps {
  readonly seedRule: SeedRuleRepository;
}

// An admin set, from the members page, what a torrent must give back before it
// may go. Snapshots are not taken again here: the next hourly pass judges every
// member's torrents against the new rule, and a click in between is rechecked
// live against it by the cleanup job.
export class SetSeedRule {
  constructor(private readonly deps: Deps) {}

  async execute(rule: SeedRule): Promise<void> {
    await this.deps.seedRule.save(rule);
  }
}
