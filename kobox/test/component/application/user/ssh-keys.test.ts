import { beforeEach, describe, expect, it } from 'vitest';
import { RemoveSshKey, SetSshKey } from '../../../../src/application/user/SetSshKey.js';
import { InvalidSshPublicKeyError } from '../../../../src/domain/user/SshPublicKey.js';
import type { AuthorizedKeysPort } from '../../../../src/domain/user/ports.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemorySshKeyRepository } from '../../../../src/infrastructure/persistence/InMemorySshKeyRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { aUser } from '../../../builders/UserBuilder.js';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7Kk1p2vQ0Hn3xYqZ8mLsRtWuVdEfGhIjKlMnOpQrSt nas';
const alice = Username.parse('alice');

class FakeAuthorizedKeys implements AuthorizedKeysPort {
  readonly written = new Map<string, string>();

  write(username: Username, line: string): Promise<void> {
    this.written.set(username.value, line);
    return Promise.resolve();
  }

  clear(username: Username): Promise<void> {
    this.written.set(username.value, '');
    return Promise.resolve();
  }
}

let repo: InMemoryUserRepository;
let keys: InMemorySshKeyRepository;
let authorizedKeys: FakeAuthorizedKeys;
let setKey: SetSshKey;
let removeKey: RemoveSshKey;

beforeEach(async () => {
  repo = new InMemoryUserRepository();
  keys = new InMemorySshKeyRepository();
  authorizedKeys = new FakeAuthorizedKeys();
  await repo.save(aUser().build());
  const deps = { repo, keys, authorizedKeys };
  setKey = new SetSshKey({ ...deps, clock: () => '2026-08-17 12:00:00' });
  removeKey = new RemoveSshKey(deps);
});

describe('a member of their own SSH key', () => {
  it('should_write_a_transfer_only_line_rather_than_the_key_as_pasted', async () => {
    // the point of the feature is a script dropping torrent files in, not a
    // shell. A pasted key alone would grant both.
    await setKey.execute({ username: alice, key: KEY });

    const line = authorizedKeys.written.get('alice') ?? '';
    expect(line.startsWith('restrict,command="internal-sftp" ')).toBe(true);
    expect(line).toContain('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5');
  });

  it('should_keep_the_key_so_the_member_can_see_which_one_is_installed', async () => {
    await setKey.execute({ username: alice, key: KEY });

    expect((await keys.find(alice))?.key.comment).toBe('nas');
  });

  it('should_refuse_a_pasted_line_that_grants_itself_options', async () => {
    await expect(
      setKey.execute({ username: alice, key: `command="/bin/sh" ${KEY}` }),
    ).rejects.toThrow(InvalidSshPublicKeyError);
    expect(authorizedKeys.written.has('alice')).toBe(false);
  });

  it('should_take_the_key_back_off_the_box_when_removed', async () => {
    await setKey.execute({ username: alice, key: KEY });

    await removeKey.execute({ username: alice });

    expect(authorizedKeys.written.get('alice')).toBe('');
    expect(await keys.find(alice)).toBeUndefined();
  });
});
