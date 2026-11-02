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

  // A rule loosened past the line may now find something to clean: with
  // automatic cleanup on, the next pass cleans rather than waiting for the
  // next climb. With it off, the member was mailed already and is not again.
  it('should_let_automatic_cleanup_run_again_once_a_warned_member_changes_their_rule', async () => {
    await preferences.chooseAutomatic(alice, 'sentOrSeeded');
    await preferences.recordWarned(alice, true);

    await setOwnRule.execute({ username: alice, choice: { kind: 'own', rule: SeedRule.of({ days: 14 }) } });

    expect((await preferences.find(alice)).warned).toBe(false);
  });

  it('should_not_mail_a_warned_member_twice_when_automatic_cleanup_is_off', async () => {
    await preferences.recordWarned(alice, true);

    await setOwnRule.execute({ username: alice, choice: { kind: 'own', rule: SeedRule.of({ days: 14 }) } });

    expect((await preferences.find(alice)).warned).toBe(true);
  });
});
