import { describe, expect, it } from 'vitest';
import { AuthenticateApp } from '../../../../src/application/portal/AuthenticateApp.js';
import { MAX_LOGIN_FAILURES } from '../../../../src/domain/portal/policy.js';
import type { PortalCredentials } from '../../../../src/domain/portal/ports.js';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryLoginAttemptsRepository } from '../../../../src/infrastructure/persistence/InMemoryLoginAttemptsRepository.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { FakeSessionTokens } from '../../../../src/infrastructure/system/fakes/FakeSessionTokens.js';

const NOW = '2026-08-17 10:00:00';
const alice = Username.parse('alice');
const TOKEN = 'a'.repeat(64);
const HASH = HashedPassword.parse(`$6$salt$${'x'.repeat(43)}`);

// `noToken` omits the key rather than setting it to undefined: with
// exactOptionalPropertyTypes those are different things, and "never issued one"
// is the absent case.
async function world(
  overrides: Partial<PortalCredentials> = {},
  options: { noToken?: boolean } = {},
) {
  const credentials = new InMemoryPortalCredentialsRepository();
  const attempts = new InMemoryLoginAttemptsRepository();
  const tokens = new FakeSessionTokens();
  await credentials.save(
    {
      username: alice,
      passwordHash: HASH,
      role: 'user',
      ...(options.noToken === true ? {} : { appTokenHash: tokens.hashToken(TOKEN) }),
      ...overrides,
    },
    NOW,
  );
  const useCase = new AuthenticateApp({ credentials, attempts, tokens, clock: () => NOW });
  return { useCase, attempts, credentials };
}

describe('AuthenticateApp', () => {
  it('should_let_a_machine_in_with_the_token_its_owner_issued', async () => {
    const { useCase } = await world();

    const app = await useCase.execute({ username: 'alice', token: TOKEN });

    expect(app?.username.value).toBe('alice');
    expect(app?.role).toBe('user');
  });

  it('should_refuse_a_wrong_token_and_count_it', async () => {
    const { useCase, attempts } = await world();

    expect(await useCase.execute({ username: 'alice', token: 'b'.repeat(64) })).toBeUndefined();
    expect((await attempts.get(alice))?.failures).toBe(1);
  });

  it('should_refuse_a_member_who_never_issued_one', async () => {
    // an absent token must not be an open door, and must not be distinguishable
    // from a wrong one by anything the caller can see
    const { useCase } = await world({}, { noToken: true });

    expect(await useCase.execute({ username: 'alice', token: TOKEN })).toBeUndefined();
  });

  it('should_refuse_a_member_still_on_a_temporary_password', async () => {
    // they have not proven who they are yet — the same rule the browser gets
    const { useCase } = await world({ mustChangePassword: true });

    expect(await useCase.execute({ username: 'alice', token: TOKEN })).toBeUndefined();
  });

  it('should_stop_answering_once_the_account_is_locked_out', async () => {
    // the same lockout as the login form: this endpoint must not be the
    // unrated way onto the same accounts
    const { useCase, attempts } = await world();
    for (let i = 0; i < MAX_LOGIN_FAILURES; i += 1) {
      await useCase.execute({ username: 'alice', token: 'b'.repeat(64) });
    }

    // even the RIGHT token is refused while the lock stands
    expect(await useCase.execute({ username: 'alice', token: TOKEN })).toBeUndefined();
    expect((await attempts.get(alice))?.lockedUntil).toBeDefined();
  });

  it('should_clear_the_count_once_a_machine_gets_in', async () => {
    const { useCase, attempts } = await world();
    await useCase.execute({ username: 'alice', token: 'b'.repeat(64) });

    await useCase.execute({ username: 'alice', token: TOKEN });

    expect(await attempts.get(alice)).toBeUndefined();
  });

  it('should_refuse_a_malformed_username_or_token_without_touching_storage', async () => {
    const { useCase, attempts } = await world();

    expect(await useCase.execute({ username: '../root', token: TOKEN })).toBeUndefined();
    expect(await useCase.execute({ username: 'alice', token: 'too-short' })).toBeUndefined();
    // a value that was never a token is not a failed attempt against the account
    expect(await attempts.get(alice)).toBeUndefined();
  });
});
