import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteStalledHashCheckRepository } from '../../../src/infrastructure/persistence/SqliteStalledHashCheckRepository.js';

const alice = Username.parse('alice');
const bob = Username.parse('bob');
const A = InfoHash.parse('A'.repeat(40));
const B = InfoHash.parse('B'.repeat(40));

let dir: string;
let db: KoboxDatabase;
let repo: SqliteStalledHashCheckRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-stalled-hash-checks-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqliteStalledHashCheckRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteStalledHashCheckRepository', () => {
  it('should_know_of_no_stalled_download_before_a_pass_found_one', async () => {
    expect(await repo.find(alice)).toEqual([]);
  });

  it('should_replace_what_a_member_had_stalled_and_leave_the_others_alone', async () => {
    await repo.replace(alice, [A, B]);
    await repo.replace(bob, [A]);

    await repo.replace(alice, [B]);

    expect(await repo.find(alice)).toEqual([B]);
    expect(await repo.find(bob)).toEqual([A]);
  });
});
