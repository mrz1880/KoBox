import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(await repo.find(alice)).toEqual({ automatic: 'off', warned: false });
  });

  it('should_remember_the_choice_a_member_made_for_them_alone', async () => {
    await repo.chooseAutomatic(alice, 'sentOrSeeded');

    expect(await repo.find(alice)).toEqual({ automatic: 'sentOrSeeded', warned: false });
    expect(await repo.find(bob)).toEqual({ automatic: 'off', warned: false });
  });

  it('should_keep_the_choice_when_the_member_is_warned_and_the_warning_when_they_choose', async () => {
    await repo.chooseAutomatic(alice, 'sentOnly');
    await repo.recordWarned(alice, true);
    await repo.chooseAutomatic(alice, 'off');

    expect(await repo.find(alice)).toEqual({ automatic: 'off', warned: true });
  });

  it('should_forget_the_warning_once_the_member_went_back_under_the_line', async () => {
    await repo.recordWarned(alice, true);
    await repo.recordWarned(alice, false);

    expect(await repo.find(alice)).toEqual({ automatic: 'off', warned: false });
  });
});
