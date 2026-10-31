import { beforeEach, describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import { IpAddress } from '../../../src/domain/shared/IpAddress.js';
import { DynDnsHost } from '../../../src/domain/security/DynDnsHost.js';
import { Label } from '../../../src/domain/torrent/Label.js';
import { SyncMode } from '../../../src/domain/torrent/SyncMode.js';
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
    // the real actions, and no bandwidth figure or port number
    expect(response.body).toContain('/rutorrent');
    expect(response.body).toContain('/media');
    // debrid downloads were retired: nothing may still lead to them
    expect(response.body).not.toContain('/downloads');
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
      url: '/admin',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    // the fleet count includes both seeded users
    expect(response.body).toContain('/admin/users');
  });
});

describe('the folders page', () => {
  // members look for their categories under that name, not under "Sending",
  // which is only what happens to a folder once a download finishes
  it('should_be_called_folders_in_the_menu', async () => {
    const response = await world.server.inject({ method: 'GET', url: '/', headers: { cookie: user.cookie } });

    expect(response.body).toMatch(/<a href="\/sync"[^>]*><span class="label">Folders<\/span>/);
    expect(response.body).not.toContain('>Sending<');
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

  it('should_refuse_a_new_password_too_long_to_reach_every_service_without_crashing', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/password',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, current: '8chars!!', next: 'x'.repeat(101) }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('at most 100 characters');
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_call_an_impossible_current_password_incorrect_rather_than_crash', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/password',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, current: 'y'.repeat(120), next: 'a-fresh-password' }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('current password is incorrect');
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
      expect(JSON.stringify(job.payload)).not.toContain('a-fresh-password');
      // sealed for the worker, which opens it back to what was typed
      expect((await world.passwords.open(job.payload.sealedPassword)).reveal()).toBe('a-fresh-password');
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
  // three of these forms sat bare at full width, the others in a card
  it.each(['/access/addresses/add', '/access/hostnames/add', '/access/ssh-key', '/access/language'])(
    'should_frame_the_form_posting_to_%s_like_every_form_with_fields',
    async (action) => {
      const response = await world.server.inject({
        method: 'GET',
        url: '/access',
        headers: { cookie: user.cookie },
      });

      expect(response.body).toContain(`<form class="card" method="post" action="${action}">`);
    },
  );

  it('should_show_what_just_happened_on_the_account_page', async () => {
    const saved = await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'en' }),
    });

    const response = await world.server.inject({
      method: 'GET',
      url: saved.headers.location ?? '',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('<div class="flash">Saved.</div>');
  });

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

  // a member saw only "Download" beside their films and could not tell why
  it('should_say_beside_each_video_whether_it_plays_here_and_why_not', async () => {
    await give(alice, 'films/Playable.mp4', 'films/Container.mkv', 'films/Container.nfo');

    const body = (
      await world.server.inject({ method: 'GET', url: '/media', headers: { cookie: user.cookie } })
    ).body;
    // the one row holding that name: no other <tr> may start in between
    const row = (name: string) =>
      new RegExp(`<tr>(?:(?!<tr>)[^])*?${name}[^]*?</tr>`).exec(body)?.[0] ?? '';

    expect(row('Playable.mp4')).toContain('Plays here');
    expect(row('Container.mkv')).toContain('Download to watch');
    expect(row('Container.mkv')).toContain('MKV');
    expect(row('Container.nfo')).not.toMatch(/Plays here|Download to watch/);
    // and the page says once which files play in the browser
    expect(body).toContain('MP4 and WebM videos play in the browser');
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

  // the frame leaves ruTorrent the room the portal does not take: on a small
  // screen a member wants the whole window for it
  it('should_offer_rutorrent_on_its_own_in_a_new_tab', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/rutorrent',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toMatch(/<a href="\/ru\/" target="_blank" rel="noopener">Full screen<\/a>/);
  });

  // ruTorrent read its language from the browser: it follows the one the
  // member chose on the portal, through the cookie ruTorrent itself reads
  it('should_open_rutorrent_in_the_language_chosen_on_the_portal', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'fr' }),
    });
    const french = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'GET',
      url: '/rutorrent',
      headers: { cookie: french.cookie },
    });

    const cookie = [response.headers['set-cookie']].flat().find((line) => line?.startsWith('Language='));
    expect(cookie).toMatch(/^Language=fr; Path=\//);
  });

  // a member who never chose kept their browser's language in ruTorrent: the
  // portal's English default overrode it, so without a choice it hands over
  // nothing, and takes back a cookie it once set
  it('should_leave_rutorrent_to_the_browsers_language_when_none_was_chosen', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/rutorrent',
      headers: { cookie: user.cookie },
    });

    const cookie = [response.headers['set-cookie']].flat().find((line) => line?.startsWith('Language='));
    expect(cookie).toMatch(/^Language=; Max-Age=0; Path=\//);
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

describe('renaming or removing a folder', () => {
  const alice = Username.parse('alice');
  const post = (url: string, fields: Record<string, string>) =>
    world.server.inject({
      method: 'POST',
      url,
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...fields }),
    });

  const holdsADownload = async (label: string): Promise<void> => {
    await world.media.replaceFor(
      alice,
      [{ path: MediaPath.parse(`${label}/Some.Film.mkv`), sizeBytes: 1024 }],
      NOW,
    );
  };

  it('should_remove_an_empty_folder', async () => {
    const response = await post('/sync/categories/remove', { label: 'films' });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs).toEqual([
      { type: 'remove-watch-dir', payload: { username: 'alice', label: 'films' } },
    ]);
  });

  it('should_rename_an_empty_folder', async () => {
    const response = await post('/sync/categories/rename', { label: 'films', to: 'Movies' });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs).toEqual([
      { type: 'rename-watch-dir', payload: { username: 'alice', label: 'films', to: 'Movies' } },
    ]);
  });

  it('should_leave_a_folder_holding_downloads_as_it_is_and_say_why', async () => {
    // its downloads seed from its path: moving them is not done behind their back
    await holdsADownload('films');

    await post('/sync/categories/remove', { label: 'films' });
    const rename = await post('/sync/categories/rename', { label: 'films', to: 'Movies' });

    expect(world.queue.jobs).toHaveLength(0);
    const page = await world.server.inject({
      method: 'GET',
      url: String(rename.headers.location),
      headers: { cookie: user.cookie },
    });
    expect(page.body).toContain('still holds downloads');
  });

  it('should_refuse_a_new_name_already_taken_or_unsafe', async () => {
    const instance = await world.instances.findByUsername(alice);
    if (instance === undefined) {
      throw new Error('the world should have provisioned alice');
    }
    await world.instances.save(instance.addWatchDir(Label.parse('Divers')).instance);

    await post('/sync/categories/rename', { label: 'films', to: 'Divers' });
    const unsafe = await post('/sync/categories/rename', { label: 'films', to: '../up' });

    expect(unsafe.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_never_touch_a_folder_the_member_does_not_have', async () => {
    const response = await post('/sync/categories/remove', { label: 'Jeux' });

    expect(response.statusCode).toBe(404);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_offer_to_rename_or_remove_only_the_folders_that_hold_nothing', async () => {
    const instance = await world.instances.findByUsername(alice);
    if (instance === undefined) {
      throw new Error('the world should have provisioned alice');
    }
    await world.instances.save(instance.addWatchDir(Label.parse('Divers')).instance);
    await holdsADownload('films');

    const response = await world.server.inject({
      method: 'GET',
      url: '/sync',
      headers: { cookie: user.cookie },
    });

    // Divers alone: films holds a download
    expect(response.body.match(/action="\/sync\/categories\/rename"/g)).toHaveLength(1);
    expect(response.body.match(/action="\/sync\/categories\/remove"/g)).toHaveLength(1);
    expect(response.body).toContain('Holds downloads');
  });
});

describe('sending what a folder already holds', () => {
  const alice = Username.parse('alice');
  const films = Label.parse('films');

  const setFilms = async (mode: string): Promise<void> => {
    const instance = await world.instances.findByUsername(alice);
    if (instance === undefined) {
      throw new Error('the world should have provisioned alice');
    }
    await world.instances.save(instance.setSyncMode(films, SyncMode.parse(mode)));
  };

  const ask = () =>
    world.server.inject({
      method: 'POST',
      url: '/sync/categories/send-existing',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, label: 'films' }),
    });

  it('should_queue_what_a_sending_folder_already_holds', async () => {
    await setFilms('scheduled');

    const response = await ask();

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs).toEqual([
      { type: 'queue-folder-backlog', payload: { username: 'alice', label: 'films' } },
    ]);
  });

  it('should_send_nothing_from_a_folder_kept_on_the_box', async () => {
    const response = await ask();

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_offer_it_only_beside_a_folder_that_sends', async () => {
    const page = async (): Promise<string> =>
      (await world.server.inject({ method: 'GET', url: '/sync', headers: { cookie: user.cookie } }))
        .body;

    expect(await page()).not.toContain('action="/sync/categories/send-existing"');
    await setFilms('immediate');
    expect(await page()).toContain('action="/sync/categories/send-existing"');
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

  it('should_keep_the_members_choice_of_mails_about_transfers', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/sync/destination',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...aForm, transferMails: 'every' }),
    });

    const stored = await world.destinations.findByUsername(Username.parse('alice'));
    expect(stored?.transferMails).toBe('every');
    const page = await world.server.inject({
      method: 'GET',
      url: '/sync',
      headers: { cookie: user.cookie },
    });
    expect(page.body).toContain('<option value="every" selected>');
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

  // asked by a member: a file that arrived can be sent home once more
  it('should_offer_to_send_again_a_file_that_arrived', async () => {
    const queued = await world.transfers.queue(
      SyncTransfer.queue({
        username: Username.parse('alice'),
        label: Label.parse('Films'),
        source: LocalPath.parse('/home/alice/rtorrent/complete/Films/Other.Film.mkv'),
        queuedAt: '2026-08-15 10:00:00',
      }),
    );
    if (queued === undefined) {
      throw new Error('the fixture failed to queue a transfer');
    }
    await world.transfers.save(queued.start('2026-08-15 10:01:00').succeed('2026-08-15 10:05:00'));

    const response = await world.server.inject({
      method: 'GET',
      url: '/sync',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('Send again');
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
    expect(new URL(String(response.headers.location), 'https://box.example.org').searchParams.get('flash')).toBe(
      'Back in the queue.',
    );
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

  it('should_keep_the_language_the_member_chose_when_revoking', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'fr' }),
    });

    await world.server.inject({
      method: 'POST',
      url: '/access/app-token/revoke',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    expect((await world.credentials.find(Username.parse('alice')))?.language?.value).toBe('fr');
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
      url: '/password',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('Change password');
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
      url: '/password',
      headers: { cookie: french.cookie },
    });

    expect(response.body).toContain('Changer de mot de passe');
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

  it('should_speak_the_browsers_language_to_a_member_who_never_chose', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: user.cookie, 'accept-language': 'fr-FR,fr;q=0.9' },
    });

    expect(response.body).toContain('<html lang="fr">');
    expect(response.body).toContain('Accueil');
  });

  it('should_keep_a_members_choice_whatever_the_browser_says', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'en' }),
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: user.cookie, 'accept-language': 'fr' },
    });

    expect(response.body).toContain('<html lang="en">');
  });

  it('should_hand_the_language_back_to_the_browser_when_a_member_asks', async () => {
    for (const language of ['fr', 'browser']) {
      await world.server.inject({
        method: 'POST',
        url: '/access/language',
        headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ _csrf: user.csrf, language }),
      });
    }

    const page = await world.server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: user.cookie, 'accept-language': 'en' },
    });
    const rutorrent = await world.server.inject({
      method: 'GET',
      url: '/rutorrent',
      headers: { cookie: user.cookie },
    });

    expect(page.body).toContain('<html lang="en">');
    const cookie = [rutorrent.headers['set-cookie']]
      .flat()
      .find((line) => line?.startsWith('Language='));
    expect(cookie).toMatch(/^Language=; Max-Age=0; Path=\//);
  });

  it('should_offer_the_three_choices_on_the_account_page', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/access',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('action="/access/language"');
    expect(response.body.match(/name="language"/g)).toHaveLength(3);
    expect(response.body).toContain('value="browser" checked');
  });

  it('should_tick_the_language_a_member_chose', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'fr' }),
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/access',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('value="fr" checked');
    expect(response.body).not.toContain('value="browser" checked');
  });

  // someone landed on a page in the wrong language still finds their own
  it('should_name_each_language_in_its_own_tongue_to_a_french_reader', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/access',
      headers: { cookie: user.cookie, 'accept-language': 'fr' },
    });

    expect(response.body).toContain('Comme mon navigateur');
    expect(response.body).toContain('Français');
    expect(response.body).toContain('English');
    expect(response.body).not.toContain('Anglais');
  });

  it('should_confirm_a_change_in_the_members_language', async () => {
    const saved = await world.server.inject({
      method: 'POST',
      url: '/access/language',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, language: 'fr' }),
    });

    const response = await world.server.inject({
      method: 'GET',
      url: saved.headers.location ?? '',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('<div class="flash">Enregistré.</div>');
  });

  // the flash rides in the query string: anyone can put anything there, so a
  // text the catalogue does not know shows as it came, and escaped
  it('should_show_an_unknown_flash_as_it_came_and_escaped', async () => {
    const forged = '<script>alert(1)</script>';
    const response = await world.server.inject({
      method: 'GET',
      url: `/access?flash=${encodeURIComponent(forged)}`,
      headers: { cookie: user.cookie, 'accept-language': 'fr' },
    });

    expect(response.body).not.toContain(forged);
    expect(response.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  // a cache in front of the portal must not hand one browser's French page to
  // another browser asking for English
  it('should_tell_caches_a_page_depends_on_the_browsers_language', async () => {
    const response = await world.server.inject({ method: 'GET', url: '/login' });

    expect(response.headers.vary).toContain('Accept-Language');
  });
});

describe("a member's own SSH key", () => {
  const KEY =
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7Kk1p2vQ0Hn3xYqZ8mLsRtWuVdEfGhIjKlMnOpQrSt nas';

  it('should_enqueue_the_key_for_installation', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/access/ssh-key',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, key: KEY }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'set-ssh-key');
    expect(job?.payload).toMatchObject({ username: 'alice', key: KEY });
  });

  it('should_tell_the_member_what_is_wrong_rather_than_queueing_a_job_that_fails_unseen', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/access/ssh-key',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, key: 'command="/bin/sh" ' + KEY }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_only_ever_touch_the_signed_in_member', async () => {
    await world.server.inject({
      method: 'POST',
      url: '/access/ssh-key',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, key: KEY, username: 'boss' }),
    });

    const job = world.queue.jobs.find((j) => j.type === 'set-ssh-key');
    expect(job?.payload).toMatchObject({ username: 'alice' });
  });
});

describe('a member declaring where they connect from', () => {
  // nginx overwrites X-Forwarded-For with $remote_addr, and the portal trusts
  // only the loopback proxy: the header is the visitor's real address
  const fromHome = (cookie: string): Record<string, string> => ({
    cookie,
    'content-type': 'application/x-www-form-urlencoded',
    'x-forwarded-for': '203.0.113.20',
  });

  it('should_declare_the_address_they_are_connecting_from', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/access/addresses/add-current',
      headers: fromHome(user.cookie),
      payload: form({ _csrf: user.csrf }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'add-user-address');
    expect(job?.payload).toMatchObject({ username: 'alice', ipv4: '203.0.113.20' });
  });

  it('should_declare_an_address_they_type_for_a_place_they_are_not_at', async () => {
    // the NAS at home, the office: a member declares them from anywhere
    const response = await world.server.inject({
      method: 'POST',
      url: '/access/addresses/add',
      headers: fromHome(user.cookie),
      payload: form({ _csrf: user.csrf, ipv4: '198.51.100.40' }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'add-user-address');
    expect(job?.payload).toMatchObject({ username: 'alice', ipv4: '198.51.100.40' });
  });

  it('should_refuse_a_typed_address_that_is_not_one_internet_can_come_from', async () => {
    // a box-side address (192.168.x.x) is the likely mistake: it opens nothing
    for (const ipv4 of ['192.168.1.20', 'not an address']) {
      const response = await world.server.inject({
        method: 'POST',
        url: '/access/addresses/add',
        headers: fromHome(user.cookie),
        payload: form({ _csrf: user.csrf, ipv4 }),
      });

      expect(response.statusCode).toBe(303);
    }
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_say_so_rather_than_fail_when_they_come_over_ipv6', async () => {
    // the firewall rules are IPv4 only: there is nothing to declare
    const response = await world.server.inject({
      method: 'POST',
      url: '/access/addresses/add-current',
      headers: { ...fromHome(user.cookie), 'x-forwarded-for': '2001:db8::7' },
      payload: form({ _csrf: user.csrf }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_show_them_their_own_addresses_and_where_they_are_now_but_nobody_elses', async () => {
    await world.addresses.add(Username.parse('alice'), IpAddress.parse('198.51.100.7'));
    await world.addresses.add(Username.parse('boss'), IpAddress.parse('198.51.100.99'));

    const response = await world.server.inject({
      method: 'GET',
      url: '/access',
      headers: fromHome(user.cookie),
    });

    expect(response.body).toContain('198.51.100.7');
    expect(response.body).toContain('203.0.113.20');
    expect(response.body).not.toContain('198.51.100.99');
  });

  it('should_offer_to_type_another_address_even_once_the_current_one_is_declared', async () => {
    await world.addresses.add(Username.parse('alice'), IpAddress.parse('203.0.113.20'));

    const response = await world.server.inject({
      method: 'GET',
      url: '/access',
      headers: fromHome(user.cookie),
    });

    expect(response.body).toContain('action="/access/addresses/add"');
  });

  it('should_remove_one_of_their_own_addresses_but_never_someone_elses', async () => {
    await world.addresses.add(Username.parse('alice'), IpAddress.parse('198.51.100.7'));
    await world.addresses.add(Username.parse('boss'), IpAddress.parse('198.51.100.99'));

    for (const ipv4 of ['198.51.100.7', '198.51.100.99']) {
      await world.server.inject({
        method: 'POST',
        url: '/access/addresses/remove',
        headers: fromHome(user.cookie),
        payload: form({ _csrf: user.csrf, ipv4 }),
      });
    }

    const removals = world.queue.jobs.filter((j) => j.type === 'remove-user-address');
    expect(removals.map((j) => j.payload)).toEqual([
      expect.objectContaining({ username: 'alice', ipv4: '198.51.100.7' }),
    ]);
  });
});

describe('a member declaring a dynamic hostname', () => {
  const post = (url: string, fields: Record<string, string>) =>
    world.server.inject({
      method: 'POST',
      url,
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, ...fields }),
    });

  it('should_declare_a_hostname_whose_address_follows_their_box', async () => {
    // a home address that changes on its own: the name keeps up, the member doesn't have to
    const response = await post('/access/hostnames/add', { hostname: 'Alice-Home.dyndns.example' });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs.map((j) => [j.type, j.payload])).toEqual([
      ['add-user-hostname', expect.objectContaining({ username: 'alice', hostname: 'alice-home.dyndns.example' })],
    ]);
  });

  it('should_refuse_what_is_not_a_hostname', async () => {
    for (const hostname of ['198.51.100.7', 'home', 'a b.example']) {
      expect((await post('/access/hostnames/add', { hostname })).statusCode).toBe(303);
    }

    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_show_their_own_hostnames_with_the_address_they_point_at_but_nobody_elses', async () => {
    await world.addresses.addHostname(Username.parse('alice'), DynDnsHost.parse('alice.dyndns.example'));
    await world.addresses.updateResolvedIp(
      Username.parse('alice'),
      DynDnsHost.parse('alice.dyndns.example'),
      IpAddress.parse('198.51.100.50'),
    );
    await world.addresses.addHostname(Username.parse('boss'), DynDnsHost.parse('boss.dyndns.example'));

    const response = await world.server.inject({
      method: 'GET',
      url: '/access',
      headers: { cookie: user.cookie },
    });

    expect(response.body).toContain('alice.dyndns.example');
    expect(response.body).toContain('198.51.100.50');
    expect(response.body).not.toContain('boss.dyndns.example');
    // the address belongs to the name: removing it alone would be undone in five minutes
    expect(response.body).not.toContain('name="ipv4" value="198.51.100.50"');
  });

  it('should_remove_one_of_their_own_hostnames_but_never_someone_elses', async () => {
    await world.addresses.addHostname(Username.parse('alice'), DynDnsHost.parse('alice.dyndns.example'));
    await world.addresses.addHostname(Username.parse('boss'), DynDnsHost.parse('boss.dyndns.example'));

    for (const hostname of ['alice.dyndns.example', 'boss.dyndns.example']) {
      await post('/access/hostnames/remove', { hostname });
    }

    expect(world.queue.jobs.map((j) => [j.type, j.payload])).toEqual([
      ['remove-user-hostname', expect.objectContaining({ username: 'alice', hostname: 'alice.dyndns.example' })],
    ]);
  });
});

describe('the admin overview and the blocklists', () => {
  // a fresh box blocked nothing until somebody thought of importing the
  // catalog; the overview is where an admin looks first
  it('should_say_nothing_is_blocked_and_offer_the_step_that_is_missing', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('Nothing is blocked');
    expect(response.body).toContain('action="/admin/blocklists/import-catalog"');
  });
});
