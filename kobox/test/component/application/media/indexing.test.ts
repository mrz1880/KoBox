import { beforeEach, describe, expect, it } from 'vitest';
import { IndexUserMedia } from '../../../../src/application/media/IndexUserMedia.js';
import { MediaPath } from '../../../../src/domain/media/MediaFile.js';
import type { MediaEntry, MediaScanPort } from '../../../../src/domain/media/ports.js';
import type { Username } from '../../../../src/domain/user/Username.js';
import { Username as U } from '../../../../src/domain/user/Username.js';
import { InMemoryMediaRepository } from '../../../../src/infrastructure/persistence/InMemoryMediaRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

const NOW = '2026-08-08 10:00:00';

class FakeScanner implements MediaScanPort {
  readonly byUser = new Map<string, MediaEntry[]>();
  failFor: string | undefined;
  scan(username: Username): Promise<readonly MediaEntry[]> {
    if (this.failFor === username.value) {
      return Promise.reject(new Error('home unreadable'));
    }
    return Promise.resolve(this.byUser.get(username.value) ?? []);
  }
}

function entry(path: string, size = 1024): MediaEntry {
  return { path: MediaPath.parse(path), sizeBytes: size };
}

let users: InMemoryUserRepository;
let repo: InMemoryMediaRepository;
let scanner: FakeScanner;

beforeEach(async () => {
  users = new InMemoryUserRepository();
  repo = new InMemoryMediaRepository();
  scanner = new FakeScanner();
  await users.save(new UserBuilder().build());
  await users.save(
    new UserBuilder().withUsername('bob').withEmail('bob@example.org')
      .withScgiPort(51102).withRtorrentPort(45002).build(),
  );
});

function indexer(): IndexUserMedia {
  return new IndexUserMedia({ users, scanner, repo, clock: () => NOW });
}

describe('IndexUserMedia', () => {
  it('should_record_what_each_user_has', async () => {
    scanner.byUser.set('alice', [entry('films/a.mkv'), entry('series/b.mp4')]);
    scanner.byUser.set('bob', [entry('films/c.mkv')]);

    await indexer().execute();

    expect(await repo.listFor(U.parse('alice'))).toHaveLength(2);
    expect(await repo.listFor(U.parse('bob'))).toHaveLength(1);
  });

  it('should_drop_files_that_vanished_from_the_directory', async () => {
    scanner.byUser.set('alice', [entry('films/a.mkv'), entry('films/gone.mkv')]);
    await indexer().execute();

    scanner.byUser.set('alice', [entry('films/a.mkv')]);
    await indexer().execute();

    // the index mirrors the directory: a file deleted over SFTP leaves the list
    const listed = await repo.listFor(U.parse('alice'));
    expect(listed.map((file) => file.path.value)).toEqual(['films/a.mkv']);
  });

  it('should_keep_a_previous_listing_when_one_home_cannot_be_read', async () => {
    scanner.byUser.set('alice', [entry('films/a.mkv')]);
    await indexer().execute();
    scanner.failFor = 'alice';
    scanner.byUser.set('bob', [entry('films/c.mkv')]);

    await indexer().execute();

    // alice keeps hers rather than being blanked, and bob is still indexed
    expect(await repo.listFor(U.parse('alice'))).toHaveLength(1);
    expect(await repo.listFor(U.parse('bob'))).toHaveLength(1);
  });

  it('should_skip_a_suspended_user', async () => {
    await users.save(new UserBuilder().build().suspend().user);
    scanner.byUser.set('alice', [entry('films/a.mkv')]);

    await indexer().execute();

    expect(await repo.listFor(U.parse('alice'))).toHaveLength(0);
  });
});
