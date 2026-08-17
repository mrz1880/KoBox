import { beforeEach, describe, expect, it } from 'vitest';
import { Quota } from '../../../src/domain/user/Quota.js';
import { Username } from '../../../src/domain/user/Username.js';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;
let user: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
  user = await loginAs(world, 'alice');
});

describe('admin users list', () => {
  it('should_refuse_non_admin_sessions', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should_list_users_with_status_for_admins', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('alice');
    expect(response.body).toContain('boss');
    expect(response.body).toContain('active');
  });
});

describe('admin user creation', () => {
  it('should_enqueue_a_create_user_job_with_a_hashed_password', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        username: 'carol',
        email: 'carol@example.org',
        password: 'brand-new-password',
        quotaGib: '412',
        accountType: 'normal',
        role: 'user',
      }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'create-user');
    expect(job).toBeDefined();
    if (job?.type === 'create-user') {
      expect(job.payload.username).toBe('carol');
      expect(job.payload.passwordHash.startsWith('$6$')).toBe(true);
      expect(JSON.stringify(job.payload)).not.toContain('brand-new-password');
      expect(job.payload.role).toBe('user');
    }
  });

  it('should_reject_invalid_input_without_enqueueing', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        username: 'Tony Z; rm -rf /',
        email: 'not-an-email',
        password: 'brand-new-password',
        quotaGib: '412',
        accountType: 'normal',
        role: 'user',
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_require_csrf', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        username: 'carol',
        email: 'carol@example.org',
        password: 'brand-new-password',
        quotaGib: '412',
        accountType: 'normal',
        role: 'user',
      }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_refuse_non_admin_creation_attempts', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: user.csrf,
        username: 'carol',
        email: 'carol@example.org',
        password: 'brand-new-password',
        quotaGib: '412',
        accountType: 'normal',
        role: 'user',
      }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });
});

describe('admin user lifecycle actions', () => {
  it.each([
    ['suspend', 'suspend-user'],
    ['resume', 'resume-user'],
    ['delete', 'delete-user'],
  ] as const)('should_enqueue_%s_as_a_typed_job', async (action, jobType) => {
    const response = await world.server.inject({
      method: 'POST',
      url: `/admin/users/alice/${action}`,
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs.map((j) => j.type)).toEqual([jobType]);
  });

  it('should_enqueue_a_password_reset_with_a_hash_only', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/alice/password',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, password: 'fresh-password-42' }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs[0];
    expect(job?.type).toBe('change-password');
    if (job?.type === 'change-password') {
      expect(job.payload.passwordHash.startsWith('$6$')).toBe(true);
      expect(JSON.stringify(job.payload)).not.toContain('fresh-password-42');
    }
  });

  it('should_show_the_user_detail_page', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('alice@example.org');
    expect(response.body).toContain('/admin/users/alice/suspend');
  });

  it('should_404_on_unknown_users_without_leaking', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users/ghost',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('admin per-instance settings', () => {
  it('should_let_an_admin_allow_public_trackers_for_one_member', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/alice/public-trackers',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, allowed: 'on' }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'set-allow-public-tracker');
    expect(job?.payload).toMatchObject({ username: 'alice', allowed: true });
  });

  it('should_let_an_admin_take_the_permission_back', async () => {
    // an unchecked box sends no field at all, which is the whole difficulty:
    // "absent" has to mean "off" and not "leave it alone"
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/alice/public-trackers',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'set-allow-public-tracker');
    expect(job?.payload).toMatchObject({ username: 'alice', allowed: false });
  });

  it('should_show_on_the_member_page_where_they_stand_on_public_trackers', async () => {
    // the setting existed as a use case for months with no way to reach it:
    // the control has to be on the page, not just behind the URL
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('/admin/users/alice/public-trackers');
    expect(response.body).toContain('private trackers only');
  });

  it('should_reflect_the_permission_once_it_is_granted', async () => {
    const instance = await world.instances.findByUsername(Username.parse('alice'));
    if (instance === undefined) {
      throw new Error('the world should have provisioned alice');
    }
    await world.instances.save(instance.setAllowPublicTracker(true));

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('any tracker, public ones included');
    // the box has to come back pre-ticked, or saving the form silently
    // revokes what the admin just granted
    expect(response.body).toContain('name="allowed" checked');
  });

  it('should_let_an_admin_stop_a_member_own_post_download_scripts', async () => {
    // the checkbox is phrased positively ("run them"), the flag is negative
    // ("disabled"): the inversion has to happen once, here, and be pinned
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/alice/finish-scripts',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'set-sync-disabled');
    expect(job?.payload).toMatchObject({ username: 'alice', disabled: true });
  });

  it('should_let_an_admin_move_one_member_quota', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/alice/quota',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, quotaGib: '900' }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'set-user-quota');
    expect(job?.payload).toMatchObject({ username: 'alice', quotaGib: 900 });
  });

  it('should_show_the_allowance_and_what_the_disk_actually_holds', async () => {
    await world.diskSamples.save({
      username: Username.parse('alice'),
      used: Quota.gib(103),
      sampledAt: '2026-08-17 09:00:00',
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('/admin/users/alice/quota');
    expect(response.body).toContain('103');
  });

  it('should_offer_the_scripts_control_on_the_member_page', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('/admin/users/alice/finish-scripts');
    expect(response.body).toContain('name="run" checked');
  });
});

describe('reusing content already on the box', () => {
  it('should_let_an_admin_choose_what_happens_to_a_duplicate', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/alice/recycling',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, mode: 'hardlink' }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'set-recycling');
    expect(job?.payload).toMatchObject({ username: 'alice', mode: 'hardlink' });
  });

  it('should_refuse_a_mode_that_does_not_exist', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/users/alice/recycling',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, mode: 'symlink' }),
    });

    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_say_on_the_page_what_sharing_costs_before_it_is_chosen', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('/admin/users/alice/recycling');
    expect(response.body).toContain('quota');
  });
});

describe('the admin console in French', () => {
  it('should_translate_the_console_for_an_admin_who_asked_for_french', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, language: 'fr' }),
    });
    const french = await loginAs(world, 'boss');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: french.cookie },
    });

    expect(response.body).toContain('Créer un membre');
    expect(response.body).toContain('Listes de blocage');
  });

  it('should_render_the_long_explanations_in_english_rather_than_their_key', async () => {
    // a keyed paragraph has no English string to fall back to, so English
    // needs a row of its own or an English admin reads "members.intro"
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).not.toContain('members.intro');
    expect(response.body).toContain('Everyone with an account on the box');
  });
});
