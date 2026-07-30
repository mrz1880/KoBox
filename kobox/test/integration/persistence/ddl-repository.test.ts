import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DebridDownload } from '../../../src/domain/ddl/DebridDownload.js';
import { DownloadCategory } from '../../../src/domain/ddl/DownloadCategory.js';
import { DownloadGid } from '../../../src/domain/ddl/DownloadGid.js';
import { FilehosterLink } from '../../../src/domain/ddl/FilehosterLink.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteDebridAccountRepository } from '../../../src/infrastructure/persistence/SqliteDebridAccountRepository.js';
import { SqliteDebridDownloadRepository } from '../../../src/infrastructure/persistence/SqliteDebridDownloadRepository.js';

let dir: string;
let db: KoboxDatabase;

const alice = Username.parse('alice');
const bob = Username.parse('bob');
const link = FilehosterLink.parse('https://1fichier.example/abc');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-ddl-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteDebridDownloadRepository', () => {
  it('should_insert_and_read_back_a_request', async () => {
    const repo = new SqliteDebridDownloadRepository(db);

    const saved = await repo.save(
      DebridDownload.request(
        { username: alice, category: DownloadCategory.films, sourceLink: link },
        '2026-07-26 12:00:00',
      ),
    );

    expect(saved.id).toBe(1);
    const found = await repo.findById(1);
    expect(found?.username.value).toBe('alice');
    expect(found?.category.value).toBe('films');
    expect(found?.sourceLink.value).toBe('https://1fichier.example/abc');
    expect(found?.status).toBe('pending');
  });

  it('should_update_in_place_on_a_transition', async () => {
    const repo = new SqliteDebridDownloadRepository(db);
    const saved = await repo.save(
      DebridDownload.request(
        { username: alice, category: DownloadCategory.films, sourceLink: link },
        '2026-07-26 12:00:00',
      ),
    );

    await repo.save(saved.startedWith(DownloadGid.parse('2089b05ecca3d829')));

    const found = await repo.findById(saved.id ?? 0);
    expect(found?.status).toBe('downloading');
    expect(found?.gid?.value).toBe('2089b05ecca3d829');
  });

  it('should_list_only_active_downloads', async () => {
    const repo = new SqliteDebridDownloadRepository(db);
    const a = await repo.save(
      DebridDownload.request({ username: alice, category: DownloadCategory.films, sourceLink: link }, 'now'),
    );
    await repo.save(a.startedWith(DownloadGid.parse('2089b05ecca3d829')));
    await repo.save(
      DebridDownload.request({ username: bob, category: DownloadCategory.series, sourceLink: link }, 'now'),
    ); // stays pending

    const active = await repo.listActive();

    expect(active).toHaveLength(1);
    expect(active[0]?.username.value).toBe('alice');
  });

  it('should_list_a_users_own_downloads', async () => {
    const repo = new SqliteDebridDownloadRepository(db);
    await repo.save(
      DebridDownload.request({ username: alice, category: DownloadCategory.films, sourceLink: link }, 'now'),
    );
    await repo.save(
      DebridDownload.request({ username: bob, category: DownloadCategory.series, sourceLink: link }, 'now'),
    );

    expect(await repo.listForUser(alice)).toHaveLength(1);
    expect(await repo.listForUser(bob)).toHaveLength(1);
  });
});

describe('SqliteDebridAccountRepository', () => {
  const NOW = '2026-07-30 12:00:00';

  it('should_store_and_read_back_a_sealed_key_per_user', async () => {
    const repo = new SqliteDebridAccountRepository(db);

    await repo.save(alice, 'sealed-alice', NOW);
    await repo.save(bob, 'sealed-bob', NOW);

    expect(await repo.findEncrypted(alice)).toBe('sealed-alice');
    expect(await repo.findEncrypted(bob)).toBe('sealed-bob');
    expect(await repo.has(alice)).toBe(true);
  });

  it('should_replace_the_previous_key_instead_of_accumulating_secrets', async () => {
    const repo = new SqliteDebridAccountRepository(db);
    await repo.save(alice, 'sealed-old', NOW);

    await repo.save(alice, 'sealed-new', '2026-07-31 09:00:00');

    expect(await repo.findEncrypted(alice)).toBe('sealed-new');
  });

  it('should_report_no_account_for_a_user_who_never_set_one', async () => {
    const repo = new SqliteDebridAccountRepository(db);

    expect(await repo.findEncrypted(alice)).toBeUndefined();
    expect(await repo.has(alice)).toBe(false);
  });

  it('should_remove_a_key_on_request', async () => {
    const repo = new SqliteDebridAccountRepository(db);
    await repo.save(alice, 'sealed-alice', NOW);

    await repo.remove(alice);

    expect(await repo.has(alice)).toBe(false);
  });
});
