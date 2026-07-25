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
