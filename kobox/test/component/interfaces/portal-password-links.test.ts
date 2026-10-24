import { beforeEach, describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import { buildPortalWorld, form, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;

// what a member gets in their mailbox: the link the portal minted for them
async function linkMailedTo(recipient: string): Promise<string> {
  const mail = (await world.outbox.listRecent(20)).find((m) => m.recipient === recipient);
  const link = /\/password-link\/[0-9a-f]+/.exec(mail?.body ?? '')?.[0];
  if (link === undefined) throw new Error(`no link mailed to ${recipient}`);
  return link;
}

async function requestReset(identifier: string) {
  return world.server.inject({
    method: 'POST',
    url: '/forgot-password',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({ identifier }),
  });
}

beforeEach(async () => {
  world = await buildPortalWorld();
});

describe('forgot password', () => {
  it('should_be_offered_from_the_sign_in_page', async () => {
    const response = await world.server.inject({ method: 'GET', url: '/login' });

    expect(response.body).toContain('href="/forgot-password"');
  });

  it('should_answer_the_same_way_whether_or_not_the_member_exists', async () => {
    const known = await requestReset('alice');
    const unknown = await requestReset('nobody');

    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.body).toBe(unknown.body);
    expect((await world.outbox.listRecent(20)).map((m) => m.recipient)).toHaveLength(1);
  });
});

describe('the password link page', () => {
  it('should_let_the_member_choose_a_password_once', async () => {
    await requestReset('alice');
    const user = await world.users.findByUsername(Username.parse('alice'));
    const link = await linkMailedTo(user?.email.value ?? '');

    const page = await world.server.inject({ method: 'GET', url: link });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="password"');

    const chosen = await world.server.inject({
      method: 'POST',
      url: link,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ password: 'my-new-secret-1', confirm: 'my-new-secret-1' }),
    });
    expect(chosen.statusCode).toBe(200);
    expect(chosen.body).toContain('href="/login"');
    const job = world.queue.jobs.at(-1);
    expect(job?.type).toBe('change-password');
    if (job?.type === 'change-password') {
      expect((await world.passwords.open(job.payload.sealedPassword)).reveal()).toBe('my-new-secret-1');
    }

    const again = await world.server.inject({ method: 'GET', url: link });
    expect(again.body).toContain('no longer works');
  });

  it('should_ask_again_when_the_two_passwords_differ_or_one_is_refused', async () => {
    await requestReset('alice');
    const user = await world.users.findByUsername(Username.parse('alice'));
    const link = await linkMailedTo(user?.email.value ?? '');

    const mismatch = await world.server.inject({
      method: 'POST',
      url: link,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ password: 'my-new-secret-1', confirm: 'my-new-secret-2' }),
    });
    const tooShort = await world.server.inject({
      method: 'POST',
      url: link,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ password: 'short', confirm: 'short' }),
    });

    expect(mismatch.body).toContain('do not match');
    expect(tooShort.body).toContain('at least 8 characters');
    expect(world.queue.jobs).toHaveLength(0);
    // and the link still works for the next attempt
    expect((await world.server.inject({ method: 'GET', url: link })).body).toContain('name="password"');
  });

  it('should_say_an_unknown_link_no_longer_works_without_saying_why', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: `/password-link/${'f'.repeat(64)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('no longer works');
    expect(response.body).toContain('href="/forgot-password"');
  });
});
