import { beforeEach, describe, expect, it } from 'vitest';
import { TwoStepSetup } from '../../../../src/application/portal/TwoStepSetup.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { TotpSecret } from '../../../../src/domain/portal/TotpSecret.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { FakeTotp } from '../../../../src/infrastructure/system/fakes/FakeTotp.js';

const alice = Username.parse('alice');
const bob = Username.parse('bob');
const NOW = '2026-07-25 10:00:00';
const AT_MS = Date.parse('2026-07-25T10:00:00Z');
const SECRET = TotpSecret.parse('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');

let credentials: InMemoryPortalCredentialsRepository;
let totp: FakeTotp;
let setup: TwoStepSetup;

beforeEach(async () => {
  credentials = new InMemoryPortalCredentialsRepository();
  totp = new FakeTotp();
  setup = new TwoStepSetup({ credentials, totp });
  await credentials.save({ username: alice, role: 'user', language: Language.en }, NOW);
});

function code(value: string) {
  return { username: alice, code: value, now: NOW, nowMs: AT_MS };
}

describe('TwoStepSetup.begin', () => {
  it('should_hold_a_new_secret_as_pending_and_keep_the_rest_of_the_login', async () => {
    const secret = await setup.begin(alice, NOW);

    const stored = await credentials.find(alice);
    expect(secret).toBeDefined();
    expect(stored?.twoStepPending).toBe(secret);
    expect(stored?.twoStep).toBeUndefined();
    expect(stored?.language).toBe(Language.en);
  });

  it('should_give_no_secret_to_a_member_without_a_login', async () => {
    expect(await setup.begin(bob, NOW)).toBeUndefined();
    expect(await credentials.find(bob)).toBeUndefined();
  });
});

describe('TwoStepSetup.confirm', () => {
  it('should_turn_two_step_on_with_the_pending_secret_once_a_first_code_matches', async () => {
    const secret = await setup.begin(alice, NOW);
    totp.accept('123456', 42);

    expect(await setup.confirm(code('123456'))).toBe(true);

    const stored = await credentials.find(alice);
    expect(stored?.twoStep).toEqual({ secret, lastStep: 42 });
    expect(stored).not.toHaveProperty('twoStepPending');
    expect(stored?.language).toBe(Language.en);
  });

  it('should_leave_the_pending_secret_waiting_when_the_code_is_wrong', async () => {
    const secret = await setup.begin(alice, NOW);

    expect(await setup.confirm(code('000000'))).toBe(false);

    const stored = await credentials.find(alice);
    expect(stored?.twoStepPending).toBe(secret);
    expect(stored?.twoStep).toBeUndefined();
  });

  it('should_refuse_a_code_when_nothing_was_begun', async () => {
    totp.accept('123456', 42);

    expect(await setup.confirm(code('123456'))).toBe(false);
    expect((await credentials.find(alice))?.twoStep).toBeUndefined();
  });

  it('should_refuse_a_code_for_a_member_without_a_login', async () => {
    totp.accept('123456', 42);

    expect(await setup.confirm({ ...code('123456'), username: bob })).toBe(false);
  });
});

describe('TwoStepSetup.turnOff', () => {
  async function withTwoStep(lastStep?: number): Promise<void> {
    const twoStep = lastStep === undefined ? { secret: SECRET } : { secret: SECRET, lastStep };
    await credentials.save({ username: alice, role: 'user', language: Language.en, twoStep }, NOW);
  }

  it('should_turn_it_off_with_a_code_newer_than_the_last_one_used', async () => {
    await withTwoStep(42);
    totp.accept('654321', 43);

    expect(await setup.turnOff(code('654321'))).toBe(true);

    const stored = await credentials.find(alice);
    expect(stored).not.toHaveProperty('twoStep');
    expect(stored?.language).toBe(Language.en);
  });

  it('should_refuse_the_very_code_already_used_so_it_cannot_be_replayed', async () => {
    await withTwoStep(42);
    totp.accept('654321', 42);

    expect(await setup.turnOff(code('654321'))).toBe(false);
    expect((await credentials.find(alice))?.twoStep?.secret).toBe(SECRET);
  });

  it('should_accept_a_code_of_the_first_step_when_no_code_was_ever_used', async () => {
    await withTwoStep();
    totp.accept('000000', 0);

    expect(await setup.turnOff(code('000000'))).toBe(true);
  });

  it('should_refuse_a_wrong_code', async () => {
    await withTwoStep(42);

    expect(await setup.turnOff(code('999999'))).toBe(false);
    expect((await credentials.find(alice))?.twoStep?.secret).toBe(SECRET);
  });

  it('should_have_nothing_to_turn_off_when_two_step_is_not_on', async () => {
    totp.accept('654321', 43);

    expect(await setup.turnOff(code('654321'))).toBe(false);
    expect(await setup.turnOff({ ...code('654321'), username: bob })).toBe(false);
  });
});

describe('TwoStepSetup.reset', () => {
  it('should_clear_both_the_active_and_the_pending_secret_and_nothing_else', async () => {
    await credentials.save(
      { username: alice, role: 'user', language: Language.en, twoStep: { secret: SECRET } },
      NOW,
    );
    await setup.begin(alice, NOW);

    expect(await setup.reset(alice, NOW)).toBe(true);

    const stored = await credentials.find(alice);
    expect(stored).not.toHaveProperty('twoStep');
    expect(stored).not.toHaveProperty('twoStepPending');
    expect(stored?.language).toBe(Language.en);
  });

  it('should_report_a_member_without_a_login', async () => {
    expect(await setup.reset(bob, NOW)).toBe(false);
  });
});
