import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../../../../src/application/jobs/contract.js';
import type { JobQueuePort } from '../../../../src/application/jobs/JobQueuePort.js';
import {
  InviteMember,
  PasswordLinkUnusableError,
  RequestPasswordReset,
  SendPasswordLink,
  SetPasswordFromLink,
  TooManyPasswordLinksError,
} from '../../../../src/application/portal/PasswordLinks.js';
import { Language } from '../../../../src/domain/portal/Language.js';
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
  it('should_mail_a_member_found_by_name_or_by_address_and_stay_silent_otherwise', async () => {
    await users.save(new UserBuilder().withUsername('alice').withEmail('alice@example.org').build());
    await credentials.save({ username: alice, role: 'user' }, now);
    const request = new RequestPasswordReset(deps);

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
    const request = new RequestPasswordReset(deps);

    for (let i = 0; i < 5; i += 1) {
      await request.execute('alice');
    }

    expect(await mails()).toHaveLength(3);
  });

  it('should_send_nothing_to_a_suspended_member', async () => {
    await users.save(new UserBuilder().withUsername('alice').suspended());
    await credentials.save({ username: alice, role: 'user' }, now);

    await new RequestPasswordReset(deps).execute('alice');

    expect(await mails()).toHaveLength(0);
  });
});
