import { beforeEach, describe, expect, it } from 'vitest';
import { Authenticate } from '../../../../src/application/portal/Authenticate.js';
import { Login } from '../../../../src/application/portal/Login.js';
import { Logout } from '../../../../src/application/portal/Logout.js';
import { LOCK_MINUTES, MAX_LOGIN_FAILURES } from '../../../../src/domain/portal/policy.js';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { Username } from '../../../../src/domain/user/Username.js';
import type { PasswordHasherPort } from '../../../../src/domain/user/ports.js';
import { InMemoryLoginAttemptsRepository } from '../../../../src/infrastructure/persistence/InMemoryLoginAttemptsRepository.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryPortalSessionRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalSessionRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeSessionTokens } from '../../../../src/infrastructure/system/fakes/FakeSessionTokens.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

const alice = Username.parse('alice');
const GOOD_HASH = HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}8`);
const NOW = '2026-07-25 10:00:00';

// Mirrors FakePasswordHasher in worker-loop tests: hash depends only on length.
class FakeHasher implements PasswordHasherPort {
  verifyCalls = 0;

  hash(password: Password): Promise<HashedPassword> {
    return Promise.resolve(
      HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}${String(password.reveal().length)}`),
    );
  }

  async verify(password: Password, hash: HashedPassword): Promise<boolean> {
    this.verifyCalls += 1;
    return (await this.hash(password)).value === hash.value;
  }
}

interface World {
  users: InMemoryUserRepository;
  credentials: InMemoryPortalCredentialsRepository;
  sessions: InMemoryPortalSessionRepository;
  attempts: InMemoryLoginAttemptsRepository;
  tokens: FakeSessionTokens;
  hasher: FakeHasher;
  login: Login;
  logout: Logout;
  authenticate: Authenticate;
}

let world: World;

beforeEach(async () => {
  const users = new InMemoryUserRepository();
  const credentials = new InMemoryPortalCredentialsRepository();
  const sessions = new InMemoryPortalSessionRepository();
  const attempts = new InMemoryLoginAttemptsRepository();
  const tokens = new FakeSessionTokens();
  const hasher = new FakeHasher();
  const deps = { users, credentials, sessions, attempts, tokens, hasher };
  world = {
    users,
    credentials,
    sessions,
    attempts,
    tokens,
    hasher,
    login: new Login(deps),
    logout: new Logout(deps),
    authenticate: new Authenticate(deps),
  };
  await users.save(new UserBuilder().build());
  await credentials.save({ username: alice, passwordHash: GOOD_HASH, role: 'user' }, NOW);
});

// 8 chars -> matches GOOD_HASH under FakeHasher
const goodPassword = (): Password => Password.parse('8chars!!');
const badPassword = (): Password => Password.parse('wrong-password');

describe('Login', () => {
  it('should_open_a_session_and_return_the_raw_token_and_csrf', async () => {
    const result = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('user');
      const session = await world.sessions.find(world.tokens.hashToken(result.token));
      expect(session?.username.value).toBe('alice');
      expect(session?.csrfToken).toBe(result.csrfToken);
      expect((session?.expiresAt ?? '') > NOW).toBe(true);
    }
  });

  it('should_fail_closed_on_unknown_user_or_wrong_password', async () => {
    const unknown = await world.login.execute({
      username: Username.parse('mallory'),
      password: goodPassword(),
      now: NOW,
    });
    const wrong = await world.login.execute({ username: alice, password: badPassword(), now: NOW });

    expect(unknown).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(wrong).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect((await world.attempts.get(alice))?.failures).toBe(1);
  });

  it('should_lock_after_repeated_failures_even_for_the_right_password', async () => {
    for (let i = 0; i < MAX_LOGIN_FAILURES; i += 1) {
      await world.login.execute({ username: alice, password: badPassword(), now: NOW });
    }

    const locked = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });

    expect(locked).toEqual({ ok: false, reason: 'locked' });
  });

  it('should_unlock_after_the_lock_window_and_clear_failures_on_success', async () => {
    for (let i = 0; i < MAX_LOGIN_FAILURES; i += 1) {
      await world.login.execute({ username: alice, password: badPassword(), now: NOW });
    }
    const afterLock = `2026-07-25 10:${String(LOCK_MINUTES + 1).padStart(2, '0')}:00`;

    const result = await world.login.execute({
      username: alice,
      password: goodPassword(),
      now: afterLock,
    });

    expect(result.ok).toBe(true);
    expect(await world.attempts.get(alice)).toBeUndefined();
  });

  it('should_refuse_suspended_users_only_after_a_correct_password', async () => {
    await world.users.save(new UserBuilder().suspended());

    const result = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });

    expect(result).toEqual({ ok: false, reason: 'suspended' });
    expect(await world.attempts.get(alice)).toBeUndefined();
  });

  it('should_not_disclose_suspension_to_someone_without_the_password', async () => {
    // pre-auth probing must not distinguish suspended from a normal bad login
    await world.users.save(new UserBuilder().suspended());

    const result = await world.login.execute({ username: alice, password: badPassword(), now: NOW });

    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('should_verify_against_a_dummy_hash_on_unknown_users_to_equalize_timing', async () => {
    const before = world.hasher.verifyCalls;

    await world.login.execute({
      username: Username.parse('mallory'),
      password: goodPassword(),
      now: NOW,
    });

    // an unknown username still triggers a verify (constant-time vs a real miss)
    expect(world.hasher.verifyCalls).toBe(before + 1);
  });
});

describe('Authenticate', () => {
  it('should_resolve_a_live_session_to_user_role_and_csrf', async () => {
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');

    const auth = await world.authenticate.execute({ token: login.token, now: NOW });

    expect(auth?.username.value).toBe('alice');
    expect(auth?.role).toBe('user');
    expect(auth?.csrfToken).toBe(login.csrfToken);
    expect(auth?.mustChangePassword).toBe(false);
  });

  it('should_carry_the_must_change_password_flag', async () => {
    await world.credentials.save(
      { username: alice, passwordHash: GOOD_HASH, role: 'user', mustChangePassword: true },
      NOW,
    );
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');

    const auth = await world.authenticate.execute({ token: login.token, now: NOW });

    expect(auth?.mustChangePassword).toBe(true);
  });

  it('should_reject_unknown_and_expired_tokens', async () => {
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');

    expect(await world.authenticate.execute({ token: 'not-a-token', now: NOW })).toBeUndefined();
    const expired = await world.authenticate.execute({
      token: login.token,
      now: '2026-09-01 00:00:00',
    });
    expect(expired).toBeUndefined();
    // the expired session row is gone
    expect(await world.sessions.find(world.tokens.hashToken(login.token))).toBeUndefined();
  });

  it('should_reject_sessions_of_users_suspended_mid_session', async () => {
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');
    await world.users.save(new UserBuilder().suspended());

    expect(await world.authenticate.execute({ token: login.token, now: NOW })).toBeUndefined();
  });
});

describe('Logout', () => {
  it('should_delete_the_session', async () => {
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');

    await world.logout.execute({ token: login.token });

    expect(await world.authenticate.execute({ token: login.token, now: NOW })).toBeUndefined();
  });
});
