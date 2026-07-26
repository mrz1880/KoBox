import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteLoginAttemptsRepository } from '../../../src/infrastructure/persistence/SqliteLoginAttemptsRepository.js';
import { SqlitePortalCredentialsRepository } from '../../../src/infrastructure/persistence/SqlitePortalCredentialsRepository.js';
import { SqlitePortalSessionRepository } from '../../../src/infrastructure/persistence/SqlitePortalSessionRepository.js';

let dir: string;
let db: KoboxDatabase;

const ALICE = Username.parse('alice');
const HASH = HashedPassword.parse('$6$saltsalt$4tYAmwvGF0kBIVfCJlic9NGvGtBXTNRnAt2ZAyk9OtGF6bg');
const OTHER_HASH = HashedPassword.parse(
  '$6$othersalt$4tYAmwvGF0kBIVfCJlic9NGvGtBXTNRnAt2ZAyk9OtGF6bh',
);

const SESSION = {
  id: 'a'.repeat(64),
  username: ALICE,
  csrfToken: 'b'.repeat(64),
  createdAt: '2026-07-25 10:00:00',
  expiresAt: '2026-08-01 10:00:00',
} as const;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-portal-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqlitePortalCredentialsRepository', () => {
  it('should_return_undefined_for_an_unknown_username', async () => {
    const repo = new SqlitePortalCredentialsRepository(db);

    expect(await repo.find(ALICE)).toBeUndefined();
  });

  it('should_save_then_find_credentials_with_role', async () => {
    const repo = new SqlitePortalCredentialsRepository(db);

    await repo.save({ username: ALICE, passwordHash: HASH, role: 'admin' }, '2026-07-25 10:00:00');
    const found = await repo.find(ALICE);

    expect(found?.username.value).toBe('alice');
    expect(found?.passwordHash.value).toBe(HASH.value);
    expect(found?.role).toBe('admin');
  });

  it('should_upsert_on_save_keeping_one_row_per_username', async () => {
    const repo = new SqlitePortalCredentialsRepository(db);

    await repo.save({ username: ALICE, passwordHash: HASH, role: 'user' }, '2026-07-25 10:00:00');
    await repo.save(
      { username: ALICE, passwordHash: OTHER_HASH, role: 'user' },
      '2026-07-25 11:00:00',
    );
    const found = await repo.find(ALICE);

    expect(found?.passwordHash.value).toBe(OTHER_HASH.value);
  });

  it('should_delete_credentials', async () => {
    const repo = new SqlitePortalCredentialsRepository(db);

    await repo.save({ username: ALICE, passwordHash: HASH, role: 'user' }, '2026-07-25 10:00:00');
    await repo.delete(ALICE);

    expect(await repo.find(ALICE)).toBeUndefined();
  });

  it('should_persist_the_must_change_password_flag_and_let_a_later_save_clear_it', async () => {
    const repo = new SqlitePortalCredentialsRepository(db);

    await repo.save(
      { username: ALICE, passwordHash: HASH, role: 'user', mustChangePassword: true },
      '2026-07-25 10:00:00',
    );
    expect((await repo.find(ALICE))?.mustChangePassword).toBe(true);

    await repo.save(
      { username: ALICE, passwordHash: HASH, role: 'user', mustChangePassword: false },
      '2026-07-25 11:00:00',
    );
    expect((await repo.find(ALICE))?.mustChangePassword).toBe(false);
  });

  it('should_default_the_must_change_flag_to_false_when_omitted', async () => {
    const repo = new SqlitePortalCredentialsRepository(db);

    await repo.save({ username: ALICE, passwordHash: HASH, role: 'user' }, '2026-07-25 10:00:00');

    expect((await repo.find(ALICE))?.mustChangePassword).toBe(false);
  });
});

describe('SqlitePortalSessionRepository', () => {
  it('should_create_then_find_a_session_by_id', async () => {
    const repo = new SqlitePortalSessionRepository(db);

    await repo.create(SESSION);
    const found = await repo.find(SESSION.id);

    expect(found?.username.value).toBe('alice');
    expect(found?.csrfToken).toBe(SESSION.csrfToken);
    expect(found?.expiresAt).toBe(SESSION.expiresAt);
  });

  it('should_delete_a_session_by_id', async () => {
    const repo = new SqlitePortalSessionRepository(db);

    await repo.create(SESSION);
    await repo.delete(SESSION.id);

    expect(await repo.find(SESSION.id)).toBeUndefined();
  });

  it('should_delete_all_sessions_of_a_user', async () => {
    const repo = new SqlitePortalSessionRepository(db);

    await repo.create(SESSION);
    await repo.create({ ...SESSION, id: 'c'.repeat(64) });
    await repo.deleteForUser(ALICE);

    expect(await repo.find(SESSION.id)).toBeUndefined();
    expect(await repo.find('c'.repeat(64))).toBeUndefined();
  });

  it('should_purge_only_expired_sessions', async () => {
    const repo = new SqlitePortalSessionRepository(db);

    await repo.create(SESSION);
    await repo.create({ ...SESSION, id: 'c'.repeat(64), expiresAt: '2026-07-25 09:00:00' });
    const purged = await repo.purgeExpired('2026-07-25 10:00:00');

    expect(purged).toBe(1);
    expect(await repo.find(SESSION.id)).toBeDefined();
    expect(await repo.find('c'.repeat(64))).toBeUndefined();
  });
});

describe('SqliteLoginAttemptsRepository', () => {
  it('should_return_undefined_for_a_user_with_no_failures', async () => {
    const repo = new SqliteLoginAttemptsRepository(db);

    expect(await repo.get(ALICE)).toBeUndefined();
  });

  it('should_upsert_attempt_state', async () => {
    const repo = new SqliteLoginAttemptsRepository(db);

    await repo.save({ username: ALICE, failures: 1 });
    await repo.save({ username: ALICE, failures: 5, lockedUntil: '2026-07-25 10:15:00' });
    const attempt = await repo.get(ALICE);

    expect(attempt?.failures).toBe(5);
    expect(attempt?.lockedUntil).toBe('2026-07-25 10:15:00');
  });

  it('should_clear_attempt_state', async () => {
    const repo = new SqliteLoginAttemptsRepository(db);

    await repo.save({ username: ALICE, failures: 3 });
    await repo.clear(ALICE);

    expect(await repo.get(ALICE)).toBeUndefined();
  });
});
