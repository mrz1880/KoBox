import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PasswordLink } from '../../../src/domain/portal/PasswordLink.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqlitePasswordLinkRepository } from '../../../src/infrastructure/persistence/SqlitePasswordLinkRepository.js';

const alice = Username.parse('alice');
const bob = Username.parse('bob');
const T0 = '2026-10-24 10:00:00';

let dir: string;
let db: KoboxDatabase;
let repo: SqlitePasswordLinkRepository;

function link(username: Username, token: string, purpose: 'invitation' | 'reset' = 'reset'): PasswordLink {
  return PasswordLink.issue({ username, purpose, tokenHash: token.repeat(64), now: T0 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-links-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqlitePasswordLinkRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqlitePasswordLinkRepository', () => {
  it('should_find_a_link_by_the_fingerprint_of_its_token_and_keep_its_use', async () => {
    await repo.save(link(alice, 'a', 'invitation'), T0);

    const found = await repo.findByTokenHash('a'.repeat(64));
    expect(found?.username.value).toBe('alice');
    expect(found?.purpose).toBe('invitation');
    expect(found?.expiresAt).toBe('2026-10-31 10:00:00');

    if (found === undefined) throw new Error('no link');
    await repo.save(found.use('2026-10-24 10:05:00'), '2026-10-24 10:05:00');
    expect((await repo.findByTokenHash('a'.repeat(64)))?.usedAt).toBe('2026-10-24 10:05:00');
    expect(await repo.findByTokenHash('z'.repeat(64))).toBeUndefined();
  });

  it('should_close_a_members_open_links_and_nobody_elses', async () => {
    await repo.save(link(alice, 'a'), T0);
    await repo.save(link(bob, 'b'), T0);

    await repo.closeOpen(alice, '2026-10-24 10:01:00');

    expect((await repo.findByTokenHash('a'.repeat(64)))?.isOpen('2026-10-24 10:02:00')).toBe(false);
    expect((await repo.findByTokenHash('b'.repeat(64)))?.isOpen('2026-10-24 10:02:00')).toBe(true);
  });

  it('should_count_the_links_issued_to_a_member_since_a_moment', async () => {
    await repo.save(link(alice, 'a'), '2026-10-24 09:00:00');
    await repo.save(link(alice, 'b'), '2026-10-24 10:00:00');
    await repo.save(link(bob, 'c'), '2026-10-24 10:00:00');

    expect(await repo.countIssuedSince(alice, '2026-10-24 09:30:00')).toBe(1);
  });

  it('should_tell_the_latest_link_of_a_member', async () => {
    await repo.save(link(alice, 'a', 'invitation'), '2026-10-24 09:00:00');
    await repo.save(link(alice, 'b', 'reset'), '2026-10-24 10:00:00');

    expect((await repo.latest(alice))?.tokenHash).toBe('b'.repeat(64));
    expect(await repo.latest(bob)).toBeUndefined();
  });

  it('should_forget_every_link_of_a_deleted_member', async () => {
    await repo.save(link(alice, 'a'), T0);

    await repo.deleteForUser(alice);

    expect(await repo.findByTokenHash('a'.repeat(64))).toBeUndefined();
  });
});
