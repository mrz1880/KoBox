import { beforeEach, describe, expect, it } from 'vitest';
import { SetAutomaticCleanup } from '../../../../src/application/space/SetAutomaticCleanup.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemorySpacePreferenceRepository } from '../../../../src/infrastructure/persistence/InMemorySpacePreferenceRepository.js';

const alice = Username.parse('alice');

let preferences: InMemorySpacePreferenceRepository;
let setAutomatic: SetAutomaticCleanup;

beforeEach(() => {
  preferences = new InMemorySpacePreferenceRepository();
  setAutomatic = new SetAutomaticCleanup({ preferences });
});

describe('SetAutomaticCleanup', () => {
  it('should_keep_what_the_member_lets_kobox_delete_on_its_own', async () => {
    await setAutomatic.execute({ username: alice, automatic: 'sentOnly' });

    expect((await preferences.find(alice)).automatic).toBe('sentOnly');
  });

  // mailed past the line, the member turns it on: the next pass cleans
  it('should_let_the_next_pass_clean_for_a_member_already_warned_who_turns_it_on', async () => {
    await preferences.recordWarned(alice, true);

    await setAutomatic.execute({ username: alice, automatic: 'sentOrSeeded' });

    expect(await preferences.find(alice)).toEqual({ automatic: 'sentOrSeeded', warned: false });
  });
});
