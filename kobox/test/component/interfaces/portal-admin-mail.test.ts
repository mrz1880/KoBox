import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;
let user: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
  user = await loginAs(world, 'alice');
});

describe('mail relay settings', () => {
  it('should_store_the_relay_with_a_sealed_password_and_ask_the_worker_to_apply_it', async () => {
    // the secret must not transit the jobs table, so it is sealed into the
    // settings row and the job only says "apply what is stored"
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/mail-relay',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        host: 'smtp.example.org',
        port: '587',
        user: 'postmaster@example.org',
        password: 'relay-secret-42',
      }),
    });

    expect(response.statusCode).toBe(303);
    const stored = await world.mailRelay.get();
    expect(stored?.host).toBe('smtp.example.org');
    expect(stored?.port).toBe(587);
    // the fake sealer is reversible by construction, so asking it to hide the
    // password would prove nothing. What this pins is that the value went
    // through the sealer at all; that a real seal is opaque belongs to the
    // cipher's own tests.
    expect(stored?.sealedPassword).not.toBe('relay-secret-42');
    const job = world.queue.jobs.find((j) => j.type === 'apply-mail-relay');
    expect(job).toBeDefined();
    expect(JSON.stringify(job?.payload)).not.toContain('relay-secret-42');
  });

  it('should_never_echo_the_password_back_to_the_page', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/admin/mail-relay',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        host: 'smtp.example.org',
        port: '587',
        user: 'postmaster@example.org',
        password: 'relay-secret-42',
      }),
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/mail-relay',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('smtp.example.org');
    expect(response.body).not.toContain('relay-secret-42');
  });

  it('should_queue_a_test_mail_to_the_admin_who_asked_for_it', async () => {
    // a relay you cannot test is a relay you find out about when it matters
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/mail-relay/test',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(response.statusCode).toBe(303);
    const [mail] = await world.outbox.listRecent(10);
    expect(mail?.recipient).toBe('boss@example.org');
  });

  it('should_refuse_a_non_admin', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/mail-relay',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(403);
  });
});
