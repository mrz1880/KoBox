import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../../../../src/application/jobs/contract.js';
import type { JobQueuePort } from '../../../../src/application/jobs/JobQueuePort.js';
import { UserNotFoundError } from '../../../../src/application/user/errors.js';
import {
  InviteMember,
  MemberSuspendedError,
  PasswordLinkUnusableError,
  RequestPasswordReset,
  SendPasswordLink,
  SetPasswordFromLink,
  TooManyPasswordLinksError,
} from '../../../../src/application/portal/PasswordLinks.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import type { UserEvent } from '../../../../src/domain/user/events.js';
import { EmailAddress } from '../../../../src/domain/user/EmailAddress.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryMailOutbox } from '../../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryPasswordLinkRepository } from '../../../../src/infrastructure/persistence/InMemoryPasswordLinkRepository.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakePasswordCipher } from '../../../../src/infrastructure/system/fakes/FakePasswordCipher.js';
import { FakePasswordHasher } from '../../../../src/infrastructure/system/fakes/FakePasswordHasher.js';
import { FakeSessionTokens } from '../../../../src/infrastructure/system/fakes/FakeSessionTokens.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

class RecordingQueue implements Pick<JobQueuePort, 'enqueue'> {
  readonly jobs: Job[] = [];

  enqueue(job: Job): Promise<number> {
    this.jobs.push(job);
    return Promise.resolve(this.jobs.length);
  }
}

const alice = Username.parse('alice');
const BASE = 'https://box.example.org';
let now = '2026-10-24 10:00:00';

let users: InMemoryUserRepository;
let credentials: InMemoryPortalCredentialsRepository;
let links: InMemoryPasswordLinkRepository;
let outbox: InMemoryMailOutbox;
let queue: RecordingQueue;
let passwords: FakePasswordCipher;
let deps: ConstructorParameters<typeof SendPasswordLink>[0];

beforeEach(() => {
  now = '2026-10-24 10:00:00';
  users = new InMemoryUserRepository();
  credentials = new InMemoryPortalCredentialsRepository();
  links = new InMemoryPasswordLinkRepository();
  outbox = new InMemoryMailOutbox();
  queue = new RecordingQueue();
  passwords = new FakePasswordCipher();
  deps = {
    users,
    credentials,
    links,
    outbox,
    queue,
    passwords,
    tokens: new FakeSessionTokens(),
    address: { baseUrl: () => Promise.resolve(BASE) },
    clock: () => now,
  };
});

async function mails() {
  return outbox.listRecent(20);
}

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

describe('InviteMember', () => {
  it('should_create_the_account_without_a_password_and_mail_a_link_to_choose_one', async () => {
    const { url } = await new InviteMember(deps).execute({
      username: alice,
      email: EmailAddress.parse('alice@example.org'),
      quota: Quota.gib(400),
      role: 'admin',
    });

    const job = queue.jobs[0];
    expect(job?.type).toBe('create-user');
    if (job?.type === 'create-user') {
      expect(job.payload).toMatchObject({ username: 'alice', role: 'admin', quotaBytes: 400 * 1024 ** 3 });
      expect(job.payload).not.toHaveProperty('sealedPassword');
    }
    expect(url).toMatch(new RegExp(`^${BASE}/password-link/[0-9a-f]+$`));
    const [mail] = await mails();
    expect(mail?.recipient).toBe('alice@example.org');
    expect(mail?.body).toContain(url);
    // French unless the member chose otherwise, and no password, ever
    expect(mail?.subject).toContain('Bienvenue');
    expect(mail?.body).toContain('Nextcloud');
    // first thing to do once in: make the folders downloads are sorted into
    expect(mail?.body).toContain('Dossiers');
  });

  it('should_refuse_a_username_that_is_taken', async () => {
    await users.save(new UserBuilder().withUsername('alice').build());

    await expect(
      new InviteMember(deps).execute({
        username: alice,
        email: EmailAddress.parse('alice@example.org'),
        quota: Quota.gib(400),
        role: 'user',
      }),
    ).rejects.toThrow(/alice/);
    expect(queue.jobs).toHaveLength(0);
  });
});

describe('SetPasswordFromLink', () => {
  it('should_seal_the_chosen_password_for_the_worker_and_close_the_link', async () => {
    const { url } = await new InviteMember(deps).execute({
      username: alice,
      email: EmailAddress.parse('alice@example.org'),
      quota: Quota.gib(400),
      role: 'user',
    });
    now = '2026-10-25 09:00:00';

    const set = new SetPasswordFromLink(deps);
    const username = await set.execute({ token: tokenOf(url), password: Password.parse('chosen-by-alice') });

    expect(username.value).toBe('alice');
    const job = queue.jobs.at(-1);
    expect(job?.type).toBe('change-password');
    if (job?.type === 'change-password') {
      expect((await passwords.open(job.payload.sealedPassword)).reveal()).toBe('chosen-by-alice');
    }
    // single use
    await expect(
      set.execute({ token: tokenOf(url), password: Password.parse('someone-else') }),
    ).rejects.toThrow(PasswordLinkUnusableError);
  });

  it('should_refuse_an_unknown_or_expired_link_the_same_way', async () => {
    const set = new SetPasswordFromLink(deps);
    await expect(
      set.execute({ token: 'f'.repeat(64), password: Password.parse('whatever-it-is') }),
    ).rejects.toThrow(PasswordLinkUnusableError);

    await users.save(new UserBuilder().withUsername('alice').build());
    await credentials.save({ username: alice, role: 'user' }, now);
    // no password yet, so this is an invitation: a week to use it
    const { url } = await new SendPasswordLink(deps).execute(alice);
    now = '2026-10-31 10:00:01';

    await expect(
      set.execute({ token: tokenOf(url ?? ''), password: Password.parse('too-late-now') }),
    ).rejects.toThrow(PasswordLinkUnusableError);
  });
});

describe('SendPasswordLink', () => {
  beforeEach(async () => {
    await users.save(new UserBuilder().withUsername('alice').build());
  });

  it('should_resend_an_invitation_to_a_member_who_never_chose_a_password', async () => {
    await credentials.save({ username: alice, role: 'user' }, now);

    const sent = await new SendPasswordLink(deps).execute(alice);

    expect(sent.purpose).toBe('invitation');
    expect(sent.url).toBeDefined();
  });

  it('should_send_a_reset_to_an_active_member_and_never_hand_its_link_back', async () => {
    const passwordHash = await new FakePasswordHasher().hash(Password.parse('the-current-one'));
    await credentials.save({ username: alice, role: 'user', language: Language.en, passwordHash }, now);

    const sent = await new SendPasswordLink(deps).execute(alice);

    expect(sent.purpose).toBe('reset');
    // a reset only ever goes to the member's own mailbox
    expect(sent.url).toBeUndefined();
    const [mail] = await mails();
    expect(mail?.subject).toMatch(/password/i);
    expect(mail?.body).toMatch(/\/password-link\/[0-9a-f]+/);
  });

  it('should_replace_the_link_the_member_still_had_open', async () => {
    await credentials.save({ username: alice, role: 'user' }, now);
    const first = await new SendPasswordLink(deps).execute(alice);
    const second = await new SendPasswordLink(deps).execute(alice);

    await expect(
      new SetPasswordFromLink(deps).execute({
        token: tokenOf(first.url ?? ''),
        password: Password.parse('from-the-old-mail'),
      }),
    ).rejects.toThrow(PasswordLinkUnusableError);
    expect(second.url).not.toBe(first.url);
  });

  it('should_stop_at_three_links_an_hour', async () => {
    await credentials.save({ username: alice, role: 'user' }, now);
    const send = new SendPasswordLink(deps);
    await send.execute(alice);
    await send.execute(alice);
    await send.execute(alice);

    await expect(send.execute(alice)).rejects.toThrow(TooManyPasswordLinksError);
    now = '2026-10-24 11:00:01';
    await expect(send.execute(alice)).resolves.toBeDefined();
  });
});

describe('RequestPasswordReset', () => {
  const told: UserEvent[] = [];
  const resetWith = () =>
    new RequestPasswordReset({
      ...deps,
      notifications: { notify: (event) => Promise.resolve(void told.push(event)) },
    });
  beforeEach(() => {
    told.length = 0;
  });

  it('should_tell_the_admins_each_time_a_link_went_out_and_never_otherwise', async () => {
    await users.save(new UserBuilder().withUsername('alice').build());
    await credentials.save({ username: alice, role: 'user' }, now);
    const request = resetWith();

    await request.execute('nobody');
    for (let i = 0; i < 5; i += 1) {
      await request.execute('alice');
    }

    // three links within the hourly limit, three notices; none for a stranger
    expect(told).toEqual([
      { type: 'PasswordResetRequested', username: 'alice' },
      { type: 'PasswordResetRequested', username: 'alice' },
      { type: 'PasswordResetRequested', username: 'alice' },
    ]);
  });

  it('should_mail_a_member_found_by_name_or_by_address_and_stay_silent_otherwise', async () => {
    await users.save(new UserBuilder().withUsername('alice').withEmail('alice@example.org').build());
    await credentials.save({ username: alice, role: 'user' }, now);
    const request = resetWith();

    await request.execute('alice');
    await request.execute('ALICE@example.org');
    await request.execute('nobody');
    await request.execute('nobody@example.org');

    expect((await mails()).map((mail) => mail.recipient)).toEqual([
      'alice@example.org',
      'alice@example.org',
    ]);
  });

  it('should_stay_silent_once_the_hourly_limit_is_reached_rather_than_tell', async () => {
    await users.save(new UserBuilder().withUsername('alice').build());
    await credentials.save({ username: alice, role: 'user' }, now);
    const request = resetWith();

    for (let i = 0; i < 5; i += 1) {
      await request.execute('alice');
    }

    expect(await mails()).toHaveLength(3);
  });

  it('should_send_nothing_to_a_suspended_member', async () => {
    await users.save(new UserBuilder().withUsername('alice').suspended());
    await credentials.save({ username: alice, role: 'user' }, now);

    await resetWith().execute('alice');

    expect(await mails()).toHaveLength(0);
  });
});

describe('InviteMember account', () => {
  it('should_open_the_account_with_the_address_and_the_shared_proxy_port', async () => {
    await new InviteMember(deps).execute({
      username: alice,
      email: EmailAddress.parse('alice@example.org'),
      quota: Quota.gib(400),
      role: 'user',
    });

    const job = queue.jobs[0];
    expect(job?.type).toBe('create-user');
    if (job?.type === 'create-user') {
      expect(job.payload).toMatchObject({ email: 'alice@example.org', proxyPort: 8080 });
    }
  });
});

describe('SendPasswordLink refusals', () => {
  it('should_refuse_a_member_who_does_not_exist', async () => {
    await expect(new SendPasswordLink(deps).execute(alice)).rejects.toThrow(UserNotFoundError);
  });

  it('should_send_no_link_to_a_suspended_member', async () => {
    await users.save(new UserBuilder().withUsername('alice').suspended());
    await credentials.save({ username: alice, role: 'user' }, now);

    await expect(new SendPasswordLink(deps).execute(alice)).rejects.toThrow(MemberSuspendedError);
    await expect(new SendPasswordLink(deps).execute(alice)).rejects.toThrow(
      'alice is suspended: no password link is sent to a suspended member',
    );
    expect(await mails()).toHaveLength(0);
  });

  it('should_count_the_whole_hour_before_letting_a_fourth_link_out', async () => {
    await users.save(new UserBuilder().withUsername('alice').build());
    await credentials.save({ username: alice, role: 'user' }, now);
    const send = new SendPasswordLink(deps);
    for (let i = 0; i < 3; i += 1) {
      await send.execute(alice);
    }

    now = '2026-10-24 10:59:59';
    await expect(send.execute(alice)).rejects.toThrow(
      'alice already got 3 password links this hour',
    );
    // the first three went out at 10:00:00: one hour later to the second, they still count
    now = '2026-10-24 11:00:00';
    await expect(send.execute(alice)).rejects.toThrow(TooManyPasswordLinksError);
  });

  it('should_write_the_reset_in_the_language_the_member_chose', async () => {
    await users.save(new UserBuilder().withUsername('alice').build());
    const passwordHash = await new FakePasswordHasher().hash(Password.parse('the-current-one'));
    await credentials.save({ username: alice, role: 'user', language: Language.en, passwordHash }, now);

    await new SendPasswordLink(deps).execute(alice);

    expect((await mails())[0]?.subject).toBe('Choose a new password');
  });
});

describe('RequestPasswordReset identifiers', () => {
  const resetWith = (overrides: Partial<typeof deps> = {}) =>
    new RequestPasswordReset({
      ...deps,
      ...overrides,
      notifications: { notify: () => Promise.resolve() },
    });

  beforeEach(async () => {
    await users.save(new UserBuilder().withUsername('alice').withEmail('alice@example.org').build());
    await credentials.save({ username: alice, role: 'user' }, now);
  });

  it('should_find_a_member_named_with_capitals_and_surrounding_spaces', async () => {
    await resetWith().execute('  Alice  ');

    expect((await mails()).map((mail) => mail.recipient)).toEqual(['alice@example.org']);
  });

  it('should_mail_the_member_whose_address_was_given_and_no_other', async () => {
    const bob = Username.parse('bob');
    await users.save(new UserBuilder().withUsername('bob').withEmail('bob@example.org').build());
    await credentials.save({ username: bob, role: 'user' }, now);

    await resetWith().execute('bob@example.org');

    expect((await mails()).map((mail) => mail.recipient)).toEqual(['bob@example.org']);
  });

  it('should_stay_silent_for_something_that_is_neither_a_name_nor_an_address', async () => {
    await resetWith().execute('alice@@example.org');
    await resetWith().execute('alice smith');

    expect(await mails()).toHaveLength(0);
  });

  it('should_not_hide_a_failure_other_than_the_hourly_limit', async () => {
    class BrokenOutbox extends InMemoryMailOutbox {
      override enqueue(): Promise<number> {
        return Promise.reject(new Error('outbox unavailable'));
      }
    }
    const broken = new BrokenOutbox();

    await expect(resetWith({ outbox: broken }).execute('alice')).rejects.toThrow(
      'outbox unavailable',
    );
  });
});

describe('SetPasswordFromLink.isOpen', () => {
  it('should_say_a_fresh_link_is_open_without_using_it', async () => {
    const { url } = await new InviteMember(deps).execute({
      username: alice,
      email: EmailAddress.parse('alice@example.org'),
      quota: Quota.gib(400),
      role: 'user',
    });
    const set = new SetPasswordFromLink(deps);

    expect(await set.isOpen(tokenOf(url))).toBe(true);
    expect(await set.isOpen(tokenOf(url))).toBe(true);
  });

  it('should_say_an_unknown_or_used_link_is_closed', async () => {
    const { url } = await new InviteMember(deps).execute({
      username: alice,
      email: EmailAddress.parse('alice@example.org'),
      quota: Quota.gib(400),
      role: 'user',
    });
    const set = new SetPasswordFromLink(deps);
    await set.execute({ token: tokenOf(url), password: Password.parse('chosen-by-alice') });

    expect(await set.isOpen(tokenOf(url))).toBe(false);
    expect(await set.isOpen('f'.repeat(64))).toBe(false);
    await expect(
      set.execute({ token: tokenOf(url), password: Password.parse('chosen-again') }),
    ).rejects.toThrow('this password link no longer works');
  });
});
