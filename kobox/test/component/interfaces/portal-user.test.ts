import { beforeEach, describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import { ComponentName } from '../../../src/domain/installation/ComponentName.js';
import { Label } from '../../../src/domain/torrent/Label.js';
import { LocalPath } from '../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../src/domain/sync/SyncTransfer.js';
import { MediaPath } from '../../../src/domain/media/MediaFile.js';
import type { VpnVariant } from '../../../src/domain/security/vpn.js';
import type { VpnProfileStorePort } from '../../../src/application/portal/ports.js';
import {
  buildPortalWorld,
  form,
  loginAs,
  NOW,
  SEAL_PREFIX,
  REMOTE_SEAL_PREFIX,
  type AgentSession,
  type PortalWorld,
} from './portalWorld.js';

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
    // the home answers "what do I want to do", not "here is your telemetry":
    // the three real actions, and no bandwidth figure or port number
    expect(response.body).toContain('/rutorrent');
    expect(response.body).toContain('/media');
    expect(response.body).toContain('/downloads');
    expect(response.body).toContain('Everything is running');
    expect(response.body).not.toContain('412');
  });

  it('should_tell_a_user_plainly_when_their_client_is_down', async () => {
    await world.fairUse.saveState(
      Username.parse('alice'),
      { level: 'none', healthState: 'unhealthy' },
      NOW,
    );

    const response = await world.server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: user.cookie },
    });

    // a sentence and a way out, not a red LED they cannot interpret
    expect(response.body).toContain('torrent client is not running');
    expect(response.body).toContain('/rutorrent');
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
    expect(response.body).toContain('Nothing here yet');
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

  it('should_say_when_the_download_engine_is_not_there_rather_than_failing_link_by_link', async () => {
    // aria2 skips its own install without an RPC secret, and every submitted
    // link then fails one at a time with a message about the last hop
    await world.components.markSkipped(
      ComponentName.parse('aria2'),
      'no aria2 RPC secret',
      '2026-08-17 12:00:00',
    );

    const response = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('not set up on this box');
  });

  it('should_offer_the_member_own_folders_rather_than_two_hard_coded_ones', async () => {
    const alice = Username.parse('alice');
    const instance = await world.instances.findByUsername(alice);
    if (instance === undefined) {
      throw new Error('the world should have provisioned alice');
    }
    await world.instances.save(instance.addWatchDir(Label.parse('Divers')).instance);

    const response = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('<option value="Divers">');
  });

  it('should_route_a_download_to_any_folder_the_member_actually_has', async () => {
    // "Sending" lists the member's real folders while this form accepted a
    // closed films|series enum: a member with a Divers folder could sync it and
    // never download into it
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: user.csrf,
        link: 'https://1fichier.example/abc',
        category: 'Divers',
      }),
    });

    expect(response.statusCode).toBe(303);
    const stored = await world.downloads.listForUser(Username.parse('alice'));
    expect(stored[0]?.category.value).toBe('Divers');
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
    expect(bossView.body).toContain('Nothing here yet');
  });
});

describe('per-user debrid account', () => {
  const KEY = 'abcdef0123456789ABCDEF';

  it('should_show_the_no_key_state_and_a_form', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('My AllDebrid account');
    expect(response.body).toContain('no key');
    expect(response.body).toContain('action="/downloads/debrid-key"');
  });

  it('should_seal_the_key_before_it_ever_leaves_the_portal', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads/debrid-key',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, apiKey: KEY }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs[0];
    expect(job?.type).toBe('set-debrid-key');
    if (job?.type === 'set-debrid-key') {
      expect(job.payload.username).toBe('alice');
      // the plaintext key must not appear anywhere in the job payload
      expect(JSON.stringify(job.payload)).not.toContain(KEY);
      // …but the sealed blob is the right one
      expect(Buffer.from(job.payload.encryptedKey, 'base64').toString()).toBe(
        `${SEAL_PREFIX}${KEY}`,
      );
    }
  });

  it('should_report_a_configured_key_without_ever_echoing_it', async () => {
    await world.debridAccounts.save(Username.parse('alice'), 'sealed-blob', NOW);

    const response = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('key configured');
    // neither the key nor its ciphertext is ever rendered back
    expect(response.body).not.toContain('sealed-blob');
    expect(response.body).toContain('Remove my key');
  });

  it('should_reject_a_malformed_key_without_enqueueing', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads/debrid-key',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, apiKey: 'https://alldebrid.com/apikeys' }),
    });

    expect(response.statusCode).toBe(200);
    // the apostrophe is html-escaped in the rendered page
    expect(response.body).toContain('look like an AllDebrid API key');
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_enqueue_a_clear_for_the_session_user_only', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads/debrid-key/clear',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    expect(response.statusCode).toBe(303);
    // the username comes from the session, never from the request body
    expect(world.queue.jobs[0]).toEqual({
      type: 'clear-debrid-key',
      payload: { username: 'alice' },
    });
  });

  it('should_require_csrf_to_set_a_key', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/downloads/debrid-key',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ apiKey: KEY }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });
});

describe('my media', () => {
  const alice = Username.parse('alice');
  const boss = Username.parse('boss');

  it('should_show_the_folders_even_before_anything_lands_in_them', async () => {
    // a folder exists before its contents do. Hiding the tree until a file
    // arrives makes an empty seedbox look broken rather than empty.
    const instance = await world.instances.findByUsername(alice);
    if (instance === undefined) {
      throw new Error('the world should have provisioned alice');
    }
    await world.instances.save(instance.addWatchDir(Label.parse('Documentaires')).instance);

    const response = await world.server.inject({
      method: 'GET',
      url: '/media',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('Documentaires');
    expect(response.body).toContain('films');
  });

  async function give(owner: Username, ...paths: string[]): Promise<void> {
    await world.media.replaceFor(
      owner,
      paths.map((path) => ({ path: MediaPath.parse(path), sizeBytes: 2 * 1024 ** 3 })),
      NOW,
    );
  }

  it('should_list_the_users_own_files_grouped_by_folder', async () => {
    await give(alice, 'films/Some.Film.mkv', 'series/Show.S01E01.mp4');

    const response = await world.server.inject({
      method: 'GET',
      url: '/media',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Some.Film.mkv');
    expect(response.body).toContain('films');
    expect(response.body).toContain('series');
  });

  it('should_offer_a_player_only_for_what_a_browser_can_play', async () => {
    await give(alice, 'films/Playable.mp4', 'films/Container.mkv');

    const response = await world.server.inject({
      method: 'GET',
      url: '/media',
      headers: { cookie: user.cookie },
    });

    // an mkv gets a download link instead of a player that would show black
    expect(response.body).toContain('/media/watch?path=films/Playable.mp4');
    expect(response.body).not.toContain('/media/watch?path=films/Container.mkv');
    expect(response.body).toContain('/media/file?path=films/Container.mkv');
  });

  it('should_hand_the_bytes_to_nginx_instead_of_reading_them', async () => {
    await give(alice, 'films/Some.Film.mkv');

    const response = await world.server.inject({
      method: 'GET',
      url: '/media/file?path=films/Some.Film.mkv',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    // the portal authorises; nginx streams, so range requests keep working
    expect(response.headers['x-accel-redirect']).toBe('/internal-media/alice/films/Some.Film.mkv');
    expect(response.body).toBe('');
  });

  it('should_never_serve_another_users_file', async () => {
    await give(boss, 'films/Admin.Only.mkv');

    const response = await world.server.inject({
      method: 'GET',
      url: '/media/file?path=films/Admin.Only.mkv',
      headers: { cookie: user.cookie },
    });

    // the path is valid and the file exists — but not in alice's index
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-accel-redirect']).toBeUndefined();
  });

  it('should_refuse_a_traversal_attempt_without_reaching_the_repository', async () => {
    for (const path of ['../../etc/passwd', '/etc/passwd', 'films/../../../etc/shadow']) {
      const response = await world.server.inject({
        method: 'GET',
        url: `/media/file?path=${encodeURIComponent(path)}`,
        headers: { cookie: user.cookie },
      });

      expect(response.statusCode, path).toBe(404);
      expect(response.headers['x-accel-redirect'], path).toBeUndefined();
    }
  });

  it('should_require_a_session', async () => {
    const response = await world.server.inject({ method: 'GET', url: '/media' });

    expect(response.statusCode).toBe(303);
  });
});

describe('ruTorrent iframe', () => {
  it('should_offer_a_self_service_restart_that_enqueues_for_the_session_user', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/rutorrent/restart',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    expect(response.statusCode).toBe(303);
    // the username comes from the session — a user cannot restart someone else's
    expect(world.queue.jobs[0]).toEqual({
      type: 'restart-rtorrent',
      payload: { username: 'alice' },
    });
  });

  it('should_require_csrf_to_restart', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/rutorrent/restart',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({}),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });

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

describe('categories and sending', () => {
  it('should_list_the_categories_a_member_owns', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/sync',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('films');
  });

  it('should_enqueue_a_new_category', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/categories',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, label: 'series' }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]).toEqual({
      type: 'add-watch-dir',
      payload: { username: 'alice', label: 'series' },
    });
  });

  it('should_refuse_a_label_that_would_not_be_a_safe_directory_name', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/categories',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, label: '../../etc' }),
    });

    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_enqueue_a_mode_change_for_a_category', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/categories/mode',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, label: 'films', mode: 'immediate' }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]).toEqual({
      type: 'set-category-sync-mode',
      payload: { username: 'alice', label: 'films', mode: 'immediate' },
    });
  });

  it('should_refuse_a_mode_that_is_not_one_of_the_three', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/categories/mode',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, label: 'films', mode: 'always' }),
    });

    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_never_let_a_member_touch_another_members_category', async () => {
    // the username is taken from the session, never from the form
    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/categories/mode',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, label: 'films', mode: 'off', username: 'boss' }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]?.payload).toMatchObject({ username: 'alice' });
  });
});

describe('where a member sends their files', () => {
  const aForm = {
    host: 'nas.example.org',
    port: '2222',
    account: 'seedbox',
    password: 'hunter2000',
    path: '/volume1/torrents',
    batchSize: '0',
    placement: 'beside-the-others',
    sendHour: '2',
  };

  it('should_store_the_password_sealed_and_never_render_it_back', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm }),
    });

    const stored = await world.destinations.findByUsername(Username.parse('alice'));
    expect(stored?.sealedPassword).toBe(`${REMOTE_SEAL_PREFIX}hunter2000`);

    // the page must never hand the password back, sealed or otherwise
    const page = await world.server.inject({
      method: 'GET',
      url: '/sync',
      headers: { cookie: user.cookie },
    });
    expect(page.body).not.toContain('hunter2000');
    expect(page.body).not.toContain(REMOTE_SEAL_PREFIX);
  });

  it('should_keep_the_stored_password_when_the_field_is_left_empty', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm }),
    });

    await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm, password: '', path: '/volume2/torrents' }),
    });

    const stored = await world.destinations.findByUsername(Username.parse('alice'));
    expect(stored?.sealedPassword).toBe(`${REMOTE_SEAL_PREFIX}hunter2000`);
    expect(stored?.path.value).toBe('/volume2/torrents');
  });

  it('should_refuse_a_host_that_would_read_as_an_ssh_option', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm, host: '-oProxyCommand=id' }),
    });

    // a leading dash is remote code execution dressed as a hostname
    expect(response.statusCode).toBe(303);
    expect(await world.destinations.findByUsername(Username.parse('alice'))).toBeUndefined();
  });

  it('should_refuse_a_remote_folder_that_climbs_out_of_itself', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm, path: '/volume1/../etc' }),
    });

    expect(await world.destinations.findByUsername(Username.parse('alice'))).toBeUndefined();
  });

  it('should_ask_the_root_worker_to_test_it_rather_than_testing_it_itself', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm }),
    });
    world.queue.jobs.length = 0;

    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/destination/test',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    // the portal holds the public half only: it cannot open the password, so it
    // cannot run the probe — it asks
    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]).toEqual({
      type: 'check-sync-destination',
      payload: { username: 'alice' },
    });
  });

  it('should_never_let_a_member_configure_another_members_destination', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm, username: 'boss' }),
    });

    expect(await world.destinations.findByUsername(Username.parse('boss'))).toBeUndefined();
    expect(await world.destinations.findByUsername(Username.parse('alice'))).toBeDefined();
  });
});

describe('the queue a member can see', () => {
  async function aFailedTransfer(): Promise<number> {
    const queued = await world.transfers.queue(
      SyncTransfer.queue({
        username: Username.parse('alice'),
        label: Label.parse('Films'),
        source: LocalPath.parse('/home/alice/rtorrent/complete/Films/Some.Film.mkv'),
        queuedAt: '2026-08-15 10:00:00',
      }),
    );
    if (queued?.id === undefined) {
      throw new Error('the fixture failed to queue a transfer');
    }
    await world.transfers.save(
      queued.start('2026-08-15 10:01:00').fail('the other machine has no room left', '2026-08-15 10:02:00'),
    );
    return queued.id;
  }

  it('should_show_what_happened_in_words_rather_than_a_state_name', async () => {
    await aFailedTransfer();

    const response = await world.server.inject({
      method: 'GET',
      url: '/sync',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('Some.Film.mkv');
    expect(response.body).toContain('did not arrive');
    expect(response.body).toContain('the other machine has no room left');
    // "queued", "pending" and friends say nothing about the member's file
    expect(response.body).not.toContain('>failed<');
  });

  it('should_ask_the_worker_to_put_a_failed_transfer_back_in_the_queue', async () => {
    const id = await aFailedTransfer();
    world.queue.jobs.length = 0;

    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/transfers/retry',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, id: String(id) }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]).toEqual({
      type: 'requeue-transfer',
      payload: { username: 'alice', id },
    });
  });

  it('should_carry_the_session_username_rather_than_one_from_the_form', async () => {
    const id = await aFailedTransfer();
    world.queue.jobs.length = 0;

    await world.server.inject({
      method: 'POST',
      url: '/sync/transfers/retry',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, id: String(id), username: 'boss' }),
    });

    expect(world.queue.jobs[0]?.payload).toMatchObject({ username: 'alice' });
  });

  it('should_refuse_an_id_that_is_not_a_positive_number', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/sync/transfers/retry',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, id: '-1' }),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('connecting an app', () => {
  it('should_issue_a_token_and_show_it_once', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/access/app-token',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    expect(response.statusCode).toBe(200);
    // shown once, on the page that issued it: only its sha256 is stored, so
    // nothing can ever display it again
    // anchored on the element that renders it: the CSRF token is emitted by the
    // same generator, so a bare pattern would match that instead
    const shown = /<p class="mono">([a-f0-9]{64})<\/p>/.exec(response.body)?.[1];
    expect(shown).toBeDefined();
    const stored = (await world.credentials.find(Username.parse('alice')))?.appTokenHash;
    expect(stored).toBeDefined();
    expect(stored).not.toBe(shown);
  });

  it('should_replace_the_previous_one_when_a_member_issues_another', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/app-token',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });
    const first = (await world.credentials.find(Username.parse('alice')))?.appTokenHash;

    await world.server.inject({
      method: 'POST',
      url: '/access/app-token',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    expect((await world.credentials.find(Username.parse('alice')))?.appTokenHash).not.toBe(first);
  });

  it('should_revoke_it_without_touching_the_account', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/app-token',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    await world.server.inject({
      method: 'POST',
      url: '/access/app-token/revoke',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    const after = await world.credentials.find(Username.parse('alice'));
    expect(after?.appTokenHash).toBeUndefined();
    // the account itself is untouched: they can still sign in
    expect(after?.passwordHash).toBeDefined();
  });

  it('should_refuse_without_a_csrf_token', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/access/app-token',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({}),
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('the language a member reads the portal in', () => {
  it('should_default_to_english_for_somebody_who_never_chose', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('Start download');
  });

  it('should_show_french_to_a_member_who_asked_for_it', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'fr' }),
    });
    const french = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'GET',
      url: '/downloads',
      headers: { cookie: french.cookie },
    });

    expect(response.body).toContain('Lancer le téléchargement');
    expect(response.body).toContain('<html lang="fr">');
  });

  it('should_leave_the_other_members_alone', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'fr' }),
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('<html lang="en">');
  });
});
