import { beforeEach, describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import type { VpnVariant } from '../../../src/domain/security/vpn.js';
import type { VpnProfileStorePort } from '../../../src/application/portal/ports.js';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

// A fake profile store keyed by "user/variant".
class FakeProfileStore implements VpnProfileStorePort {
  private readonly files = new Map<string, string>();

  put(username: string, variant: VpnVariant, content: string): void {
    this.files.set(`${username}/${variant}`, content);
  }

  read(username: Username, variant: VpnVariant): Promise<string | undefined> {
    return Promise.resolve(this.files.get(`${username.value}/${variant}`));
  }
}

let world: PortalWorld;
let user: AgentSession;
let admin: AgentSession;
let profiles: FakeProfileStore;

beforeEach(async () => {
  profiles = new FakeProfileStore();
  world = await buildPortalWorld({ profiles });
  user = await loginAs(world, 'alice');
  admin = await loginAs(world, 'boss');
});

describe('role-routed home', () => {
  it('should_show_a_personal_home_to_a_user', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('alice');
    expect(response.body).toContain('412'); // quota GiB
    expect(response.body).toContain('/access');
  });

  it('should_show_a_fleet_summary_to_an_admin', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    // the fleet count includes both seeded users
    expect(response.body).toContain('/admin/users');
  });
});

describe('self password change', () => {
  it('should_reject_a_wrong_current_password_without_enqueueing', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/password',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, current: 'wrong-password', next: 'a-new-password' }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('current password');
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_enqueue_change_password_for_self_when_current_matches', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/password',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, current: '8chars!!', next: 'a-fresh-password' }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs[0];
    expect(job?.type).toBe('change-password');
    if (job?.type === 'change-password') {
      expect(job.payload.username).toBe('alice');
      expect(job.payload.passwordHash.startsWith('$6$')).toBe(true);
      expect(JSON.stringify(job.payload)).not.toContain('a-fresh-password');
    }
  });

  it('should_require_csrf', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/password',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ current: '8chars!!', next: 'a-fresh-password' }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_reject_a_too_short_current_password_gracefully_not_500', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/password',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, current: 'short', next: 'a-fresh-password' }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('current password');
    expect(world.queue.jobs).toHaveLength(0);
  });
});

describe('my access', () => {
  it('should_list_the_three_ovpn_variants', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/access',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('/access/ovpn/tun-gw');
    expect(response.body).toContain('/access/ovpn/tun');
    expect(response.body).toContain('/access/ovpn/tap');
  });

  it('should_stream_the_users_own_profile', async () => {
    profiles.put('alice', 'tun', 'client\nremote vpn.example.org 8194\n');

    const response = await world.server.inject({
      method: 'GET',
      url: '/access/ovpn/tun',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-openvpn-profile');
    expect(response.headers['content-disposition']).toContain('kobox-tun.ovpn');
    expect(response.body).toContain('remote vpn.example.org 8194');
  });

  it('should_404_when_the_profile_is_absent', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/access/ovpn/tap',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should_reject_an_unknown_variant', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/access/ovpn/wireguard',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should_never_serve_another_users_profile', async () => {
    profiles.put('boss', 'tun', 'the admin profile');

    // alice is authenticated; the path is derived from her session, not input
    const response = await world.server.inject({
      method: 'GET',
      url: '/access/ovpn/tun',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('the admin profile');
  });
});

describe('debrid downloads', () => {
  it('should_show_the_submit_form_and_an_empty_list', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('action="/downloads"');
    expect(response.body).toContain('No downloads yet.');
  });

  it('should_persist_a_pending_row_and_enqueue_the_typed_job', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: user.csrf,
        link: 'https://1fichier.example/abc',
        category: 'films',
      }),
    });

    expect(response.statusCode).toBe(303);
    const stored = await world.downloads.listForUser(Username.parse('alice'));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe('pending');
    expect(stored[0]?.category.value).toBe('films');
    const job = world.queue.jobs[0];
    expect(job?.type).toBe('debrid-download');
    // the portal enqueues an id, never the link — resolution is the worker's job
    if (job?.type === 'debrid-download') {
      expect(job.payload.downloadId).toBe(stored[0]?.id);
      expect(JSON.stringify(job.payload)).not.toContain('1fichier');
    }
  });

  it('should_reject_a_non_http_link_without_enqueueing', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, link: 'ftp://nope/x', category: 'films' }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('valid http(s) link');
    expect(world.queue.jobs).toHaveLength(0);
    expect(await world.downloads.listForUser(Username.parse('alice'))).toHaveLength(0);
  });

  it('should_require_csrf', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ link: 'https://1fichier.example/abc', category: 'films' }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_never_list_another_users_downloads', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/downloads',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: user.csrf,
        link: 'https://1fichier.example/alice-only',
        category: 'series',
      }),
    });

    const bossView = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: admin.cookie },
    });

    expect(bossView.statusCode).toBe(200);
    expect(bossView.body).toContain('No downloads yet.');
  });
});

describe('ruTorrent iframe', () => {
  it('should_serve_a_page_that_frames_ru', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/rutorrent',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<iframe');
    expect(response.body).toContain('/ru/');
  });
});
