import { beforeEach, describe, expect, it } from 'vitest';
import { Authenticate } from '../../../../src/application/portal/Authenticate.js';
import { Login } from '../../../../src/application/portal/Login.js';
import { Logout } from '../../../../src/application/portal/Logout.js';
import { IssueAppToken } from '../../../../src/application/portal/IssueAppToken.js';
import { EnterTwoStepCode } from '../../../../src/application/portal/EnterTwoStepCode.js';
import { TwoStepSetup } from '../../../../src/application/portal/TwoStepSetup.js';
import { TotpSecret } from '../../../../src/domain/portal/TotpSecret.js';
import { FakeTotp } from '../../../../src/infrastructure/system/fakes/FakeTotp.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { LOCK_MINUTES, MAX_LOGIN_FAILURES } from '../../../../src/domain/portal/policy.js';
import type { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryLoginAttemptsRepository } from '../../../../src/infrastructure/persistence/InMemoryLoginAttemptsRepository.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryPortalSessionRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalSessionRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakePasswordHasher } from '../../../../src/infrastructure/system/fakes/FakePasswordHasher.js';
import { FakeSessionTokens } from '../../../../src/infrastructure/system/fakes/FakeSessionTokens.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

const alice = Username.parse('alice');
const NOW = '2026-07-25 10:00:00';

// The shared fake, counting verifications: a login for an unknown member must
// still pay for one, so its timing does not tell who exists.
class CountingHasher extends FakePasswordHasher {
  verifyCalls = 0;

  override verify(password: Password, hash: HashedPassword): Promise<boolean> {
    this.verifyCalls += 1;
    return super.verify(password, hash);
  }
}

interface World {
  users: InMemoryUserRepository;
  credentials: InMemoryPortalCredentialsRepository;
  sessions: InMemoryPortalSessionRepository;
  attempts: InMemoryLoginAttemptsRepository;
  tokens: FakeSessionTokens;
  hasher: CountingHasher;
  totp: FakeTotp;
  login: Login;
  logout: Logout;
  authenticate: Authenticate;
  enterCode: EnterTwoStepCode;
}

let world: World;

beforeEach(async () => {
  const users = new InMemoryUserRepository();
  const credentials = new InMemoryPortalCredentialsRepository();
  const sessions = new InMemoryPortalSessionRepository();
  const attempts = new InMemoryLoginAttemptsRepository();
  const tokens = new FakeSessionTokens();
  const hasher = new CountingHasher();
  const totp = new FakeTotp();
  const deps = { users, credentials, sessions, attempts, tokens, hasher, totp };
  world = {
    users,
    credentials,
    sessions,
    attempts,
    tokens,
    hasher,
    totp,
    login: new Login(deps),
    logout: new Logout(deps),
    authenticate: new Authenticate(deps),
    enterCode: new EnterTwoStepCode(deps),
  };
  await users.save(new UserBuilder().build());
  goodHash = await hasher.hash(goodPassword());
  await credentials.save({ username: alice, passwordHash: goodHash, role: 'user' }, NOW);
});

let goodHash: HashedPassword;
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

  // an invited member has a portal login (and a role) but no password until
  // they follow their invitation link: no password can open it
  it('should_refuse_a_member_who_has_not_chosen_a_password_yet', async () => {
    await world.credentials.save({ username: alice, role: 'user' }, NOW);
    const before = world.hasher.verifyCalls;

    const result = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });

    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    // and pays for a verify like any other miss, so timing tells nothing
    expect(world.hasher.verifyCalls).toBe(before + 1);
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
      { username: alice, passwordHash: goodHash, role: 'user', mustChangePassword: true },
      NOW,
    );
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');

    const auth = await world.authenticate.execute({ token: login.token, now: NOW });

    expect(auth?.mustChangePassword).toBe(true);
  });

  it('should_leave_the_language_open_for_a_member_who_never_chose', async () => {
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');

    const auth = await world.authenticate.execute({ token: login.token, now: NOW });

    expect(auth).toBeDefined();
    expect(auth?.chosenLanguage).toBeUndefined();
  });

  it('should_carry_the_language_a_member_chose', async () => {
    await world.credentials.save(
      { username: alice, passwordHash: goodHash, role: 'user', language: Language.fr },
      NOW,
    );
    const login = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!login.ok) throw new Error('login failed');

    const auth = await world.authenticate.execute({ token: login.token, now: NOW });

    expect(auth?.chosenLanguage).toBe(Language.fr);
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

describe('two-step sign-in', () => {
  const SECRET = TotpSecret.parse('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const AT_MS = Date.parse('2026-07-25T10:00:00Z');

  beforeEach(async () => {
    await world.credentials.save(
      { username: alice, passwordHash: goodHash, role: 'admin', twoStep: { secret: SECRET } },
      NOW,
    );
    world.totp.accept('123456', 100);
  });

  async function signInWithPassword(): Promise<string> {
    const result = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    if (!result.ok) {
      throw new Error('the password should have been accepted');
    }
    return result.token;
  }

  it('should_open_nothing_with_the_password_alone', async () => {
    const token = await signInWithPassword();

    const session = await world.authenticate.execute({ token, now: NOW });
    expect(session?.awaitingCode).toBe(true);
  });

  it('should_open_the_session_once_the_code_is_entered', async () => {
    const token = await signInWithPassword();

    const outcome = await world.enterCode.execute({ token, code: '123456', now: NOW, nowMs: AT_MS });

    expect(outcome).toBe('accepted');
    expect((await world.authenticate.execute({ token, now: NOW }))?.awaitingCode).toBe(false);
  });

  // a code seen over a shoulder opens nothing a second time
  it('should_refuse_a_code_already_used', async () => {
    await world.enterCode.execute({ token: await signInWithPassword(), code: '123456', now: NOW, nowMs: AT_MS });
    const second = await signInWithPassword();

    const outcome = await world.enterCode.execute({ token: second, code: '123456', now: NOW, nowMs: AT_MS });

    expect(outcome).toBe('wrong-code');
    expect((await world.authenticate.execute({ token: second, now: NOW }))?.awaitingCode).toBe(true);
  });

  // a guessed code costs a failed attempt, so the lockout bounds guessing
  it('should_lock_the_account_after_too_many_wrong_codes', async () => {
    const token = await signInWithPassword();
    for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
      await world.enterCode.execute({ token, code: '000000', now: NOW, nowMs: AT_MS });
    }

    const outcome = await world.enterCode.execute({ token, code: '123456', now: NOW, nowMs: AT_MS });

    expect(outcome).toBe('locked');
  });

  // a lost phone: root on the box clears it, and the member sets it up again
  it('should_let_root_clear_it_for_a_member_who_lost_their_phone', async () => {
    const setup = new TwoStepSetup({ credentials: world.credentials, totp: world.totp });

    await setup.reset(alice, NOW);

    expect((await world.credentials.find(alice))?.twoStep).toBeUndefined();
    const result = await world.login.execute({ username: alice, password: goodPassword(), now: NOW });
    expect(result.ok && result.awaitingCode).toBe(false);
  });

  // revoking the app token rebuilt the login field by field and dropped the
  // fields it did not list: two-step sign-in went with the token
  it('should_survive_the_app_token_being_thrown_away', async () => {
    const tokens = new IssueAppToken({ credentials: world.credentials, tokens: world.tokens, clock: () => NOW });
    await tokens.execute(alice);

    await tokens.revoke(alice);

    expect((await world.credentials.find(alice))?.twoStep?.secret.value).toBe(SECRET.value);
    expect((await world.credentials.find(alice))?.appTokenHash).toBeUndefined();
  });
});
