import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeedRule } from '../../../src/domain/space/SeedRule.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteSpacePreferenceRepository } from '../../../src/infrastructure/persistence/SqliteSpacePreferenceRepository.js';

const alice = Username.parse('alice');
const bob = Username.parse('bob');

let dir: string;
let db: KoboxDatabase;
let repo: SqliteSpacePreferenceRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-space-preferences-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqliteSpacePreferenceRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteSpacePreferenceRepository', () => {
  it('should_leave_automatic_cleanup_off_and_the_member_unwarned_until_anything_is_saved', async () => {
    expect(await repo.find(alice)).toEqual({ automatic: 'off', timing: 'whenSpaceRunsShort', warned: false });
  });

  it('should_remember_the_choice_a_member_made_for_them_alone', async () => {
    await repo.chooseAutomatic(alice, 'sentOrSeeded');

    expect(await repo.find(alice)).toEqual({ automatic: 'sentOrSeeded', timing: 'whenSpaceRunsShort', warned: false });
    expect(await repo.find(bob)).toEqual({ automatic: 'off', timing: 'whenSpaceRunsShort', warned: false });
  });

  it('should_keep_the_choice_when_the_member_is_warned_and_the_warning_when_they_choose', async () => {
    await repo.chooseAutomatic(alice, 'sentOnly');
    await repo.recordWarned(alice, true);
    await repo.chooseAutomatic(alice, 'off');

    expect(await repo.find(alice)).toEqual({ automatic: 'off', timing: 'whenSpaceRunsShort', warned: true });
  });

  it('should_remember_when_a_member_lets_kobox_clean_apart_from_what', async () => {
    await repo.chooseAutomatic(alice, 'sentOnly');
    await repo.chooseTiming(alice, 'onceRuleMet');
    await repo.chooseAutomatic(alice, 'sentOrSeeded');

    expect(await repo.find(alice)).toEqual({
      automatic: 'sentOrSeeded',
      timing: 'onceRuleMet',
      warned: false,
    });
  });

  it('should_forget_the_warning_once_the_member_went_back_under_the_line', async () => {
    await repo.recordWarned(alice, true);
    await repo.recordWarned(alice, false);

    expect(await repo.find(alice)).toEqual({ automatic: 'off', timing: 'whenSpaceRunsShort', warned: false });
  });

  it('should_judge_a_member_by_the_box_rule_until_they_set_their_own', async () => {
    expect(await repo.findSeedRule(alice)).toEqual({ kind: 'box' });
  });

  it('should_remember_the_rule_a_member_set_for_them_alone', async () => {
    const own = SeedRule.of({ ratio: 1.25, days: 10 });
    await repo.chooseSeedRule(alice, { kind: 'own', rule: own });

    expect(await repo.findSeedRule(alice)).toEqual({ kind: 'own', rule: own });
    expect(await repo.findSeedRule(bob)).toEqual({ kind: 'box' });
  });

  it('should_remember_a_rule_that_asks_only_for_days', async () => {
    await repo.chooseSeedRule(alice, { kind: 'own', rule: SeedRule.of({ days: 14 }) });

    expect(await repo.findSeedRule(alice)).toEqual({ kind: 'own', rule: SeedRule.of({ days: 14 }) });
  });

  it('should_go_back_to_the_box_rule_when_the_member_asks', async () => {
    await repo.chooseSeedRule(alice, { kind: 'own', rule: SeedRule.of({ days: 14 }) });
    await repo.chooseSeedRule(alice, { kind: 'box' });

    expect(await repo.findSeedRule(alice)).toEqual({ kind: 'box' });
  });

  it('should_keep_the_other_choices_when_the_member_sets_their_rule', async () => {
    await repo.chooseAutomatic(alice, 'sentOnly');
    await repo.recordWarned(alice, true);
    await repo.chooseSeedRule(alice, { kind: 'own', rule: SeedRule.of({ days: 14 }) });
    await repo.chooseAutomatic(alice, 'sentOrSeeded');

    expect(await repo.find(alice)).toEqual({ automatic: 'sentOrSeeded', timing: 'whenSpaceRunsShort', warned: true });
    expect(await repo.findSeedRule(alice)).toEqual({ kind: 'own', rule: SeedRule.of({ days: 14 }) });
  });
});
