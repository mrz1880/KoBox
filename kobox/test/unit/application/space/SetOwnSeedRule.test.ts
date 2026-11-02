import { beforeEach, describe, expect, it } from 'vitest';
import { SetOwnSeedRule } from '../../../../src/application/space/SetOwnSeedRule.js';
import { SeedRule } from '../../../../src/domain/space/SeedRule.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemorySpacePreferenceRepository } from '../../../../src/infrastructure/persistence/InMemorySpacePreferenceRepository.js';

const alice = Username.parse('alice');

let preferences: InMemorySpacePreferenceRepository;
let setOwnRule: SetOwnSeedRule;

beforeEach(() => {
  preferences = new InMemorySpacePreferenceRepository();
  setOwnRule = new SetOwnSeedRule({ preferences });
});

describe('SetOwnSeedRule', () => {
  it('should_keep_the_rule_a_member_set_for_their_own_torrents', async () => {
    const own = SeedRule.of({ days: 14 });

    await setOwnRule.execute({ username: alice, choice: { kind: 'own', rule: own } });

    expect(await preferences.findSeedRule(alice)).toEqual({ kind: 'own', rule: own });
  });
});
