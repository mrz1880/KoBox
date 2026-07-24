import { beforeEach, describe, expect, it } from 'vitest';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import type { TorrentMetainfo } from '../../../../src/domain/torrent/ports.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { AddWatchDir } from '../../../../src/application/torrent/AddWatchDir.js';
import { DeprovisionRtorrentInstance } from '../../../../src/application/torrent/DeprovisionRtorrentInstance.js';
import { HandleTorrentEvent } from '../../../../src/application/torrent/HandleTorrentEvent.js';
import { ProvisionRtorrentInstance } from '../../../../src/application/torrent/ProvisionRtorrentInstance.js';
import { RenderRtorrentConfig } from '../../../../src/application/torrent/RenderRtorrentConfig.js';
import { SetAllowPublicTracker } from '../../../../src/application/torrent/SetAllowPublicTracker.js';
import { SetSyncDisabled } from '../../../../src/application/torrent/SetSyncDisabled.js';
import { TorrentInstanceNotFoundError } from '../../../../src/application/torrent/errors.js';
import { UserNotFoundError } from '../../../../src/application/user/errors.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryTorrentRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeRtorrentControl } from '../../../../src/infrastructure/system/fakes/FakeRtorrentControl.js';
import { FakeServiceControl } from '../../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeTorrentMetainfo } from '../../../../src/infrastructure/system/fakes/FakeTorrentMetainfo.js';
import { FakeUserScriptRunner } from '../../../../src/infrastructure/system/fakes/FakeUserScriptRunner.js';
import { FakeWatchDirs } from '../../../../src/infrastructure/system/fakes/FakeWatchDirs.js';
import { loadRtorrentTemplates } from '../../../../src/infrastructure/templates/TemplateProvider.js';
import { aUser } from '../../../builders/UserBuilder.js';

const alice = Username.parse('alice');
const HASH = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');
const TORRENT_FILE = '/home/alice/rtorrent/torrents/x.torrent';

function metainfo(isPrivate: boolean): TorrentMetainfo {
  return { infoHash: HASH, name: 'x', isPrivate, announcers: [] };
}

interface Context {
  readonly users: InMemoryUserRepository;
  readonly instances: InMemoryTorrentInstanceRepository;
  readonly torrents: InMemoryTorrentRepository;
  readonly config: FakeRtorrentConfig;
  readonly watchDirs: FakeWatchDirs;
  readonly services: FakeServiceControl;
  readonly meta: FakeTorrentMetainfo;
  readonly control: FakeRtorrentControl;
  readonly scripts: FakeUserScriptRunner;
  readonly provision: ProvisionRtorrentInstance;
  readonly deprovision: DeprovisionRtorrentInstance;
  readonly render: RenderRtorrentConfig;
  readonly addWatchDir: AddWatchDir;
  readonly setSyncDisabled: SetSyncDisabled;
  readonly setAllowPublicTracker: SetAllowPublicTracker;
  readonly handleEvent: HandleTorrentEvent;
}

function makeContext(): Context {
  const users = new InMemoryUserRepository();
  const instances = new InMemoryTorrentInstanceRepository();
  const torrents = new InMemoryTorrentRepository();
  const config = new FakeRtorrentConfig();
  const watchDirs = new FakeWatchDirs();
  const services = new FakeServiceControl();
  const meta = new FakeTorrentMetainfo();
  const control = new FakeRtorrentControl();
  const scripts = new FakeUserScriptRunner();
  const templates = loadRtorrentTemplates();
  const settings = { koboxBin: '/usr/local/bin/kobox' };
  const render = new RenderRtorrentConfig({ instances, config, watchDirs, services, templates, settings });
  return {
    users,
    instances,
    torrents,
    config,
    watchDirs,
    services,
    meta,
    control,
    scripts,
    provision: new ProvisionRtorrentInstance({
      users,
      instances,
      config,
      watchDirs,
      services,
      templates,
      settings,
    }),
    deprovision: new DeprovisionRtorrentInstance({ instances, torrents, services }),
    render,
    addWatchDir: new AddWatchDir({ instances, render }),
    setSyncDisabled: new SetSyncDisabled({ instances }),
    setAllowPublicTracker: new SetAllowPublicTracker({ instances }),
    handleEvent: new HandleTorrentEvent({ instances, torrents, metainfo: meta, control, scripts }),
  };
}

let c: Context;
beforeEach(async () => {
  c = makeContext();
  await c.users.save(aUser().build()); // alice, scgi 51101, rtorrent 45001
});

describe('ProvisionRtorrentInstance', () => {
  it('should_provision_files_layout_unit_and_start_for_an_active_user', async () => {
    const { changedFiles } = await c.provision.execute({ username: alice });

    expect(changedFiles).toHaveLength(5);
    expect(c.config.contentAt('/home/alice/.rtorrent.rc')).toContain('scgi.open_port = 127.0.0.1:51101');
    expect(c.watchDirs.layoutFor(alice)).toHaveLength(1);
    expect(c.services.unitContentFor(alice)).toContain('User=alice');
    expect(await c.services.isUserServiceRunning(alice)).toBe(true);
    expect((await c.instances.findByUsername(alice))?.scgiPort.value).toBe(51101);
  });

  it('should_be_idempotent_on_rerun', async () => {
    await c.provision.execute({ username: alice });
    const { changedFiles } = await c.provision.execute({ username: alice });

    expect(changedFiles).toHaveLength(0);
    expect(c.services.restartsFor(alice)).toBe(0);
  });

  it('should_install_but_not_start_for_a_suspended_user', async () => {
    await c.users.save((await c.users.findByUsername(alice))!.suspend().user);

    await c.provision.execute({ username: alice });

    expect(c.services.unitContentFor(alice)).toBeDefined();
    expect(await c.services.isUserServiceRunning(alice)).toBe(false);
  });

  it('should_refuse_to_provision_an_unknown_user', async () => {
    await expect(c.provision.execute({ username: Username.parse('ghost') })).rejects.toThrow(
      UserNotFoundError,
    );
  });
});

describe('AddWatchDir and RenderRtorrentConfig', () => {
  it('should_add_a_watch_dir_rerender_and_restart_a_running_instance', async () => {
    await c.provision.execute({ username: alice });

    await c.addWatchDir.execute({ username: alice, label: Label.parse('films') });

    expect(c.config.contentAt('/home/alice/rtorrent/config.d/80-watch.rc')).toContain(
      'd.custom1.set=films',
    );
    expect(c.watchDirs.layoutFor(alice).map((dir) => dir.label?.value)).toEqual([
      undefined,
      'films',
    ]);
    expect(c.services.restartsFor(alice)).toBe(1);
  });

  it('should_not_restart_a_stopped_instance_on_render', async () => {
    await c.provision.execute({ username: alice });
    await c.services.stopUserService(alice);

    await c.addWatchDir.execute({ username: alice, label: Label.parse('films') });

    expect(c.services.restartsFor(alice)).toBe(0);
  });

  it('should_treat_a_duplicate_label_as_a_noop', async () => {
    await c.provision.execute({ username: alice });
    await c.addWatchDir.execute({ username: alice, label: Label.parse('films') });

    await c.addWatchDir.execute({ username: alice, label: Label.parse('films') });

    expect(c.services.restartsFor(alice)).toBe(1); // only the first add rendered
  });

  it('should_require_a_provisioned_instance', async () => {
    await expect(
      c.addWatchDir.execute({ username: alice, label: Label.parse('films') }),
    ).rejects.toThrow(TorrentInstanceNotFoundError);
  });
});

describe('flags', () => {
  it('should_persist_flags_without_touching_any_rendered_file', async () => {
    await c.provision.execute({ username: alice });
    const rcBefore = c.config.contentAt('/home/alice/.rtorrent.rc');

    await c.setSyncDisabled.execute({ username: alice, disabled: true });
    await c.setAllowPublicTracker.execute({ username: alice, allowed: true });

    const instance = await c.instances.findByUsername(alice);
    expect(instance?.syncDisabled).toBe(true);
    expect(instance?.allowPublicTracker).toBe(true);
    expect(c.config.contentAt('/home/alice/.rtorrent.rc')).toBe(rcBefore);
    expect(c.services.restartsFor(alice)).toBe(0); // flags apply at event time, no restart
  });
});

describe('HandleTorrentEvent', () => {
  beforeEach(async () => {
    await c.provision.execute({ username: alice });
  });

  it('should_early_exit_natively_on_an_xmlrpc_add_without_torrent_file', async () => {
    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      name: 'x',
    });

    expect(await c.torrents.findByInfoHash(alice, HASH)).toBeUndefined();
    expect(c.control.stopped).toHaveLength(0);
  });

  it('should_ignore_an_event_whose_torrent_file_is_outside_the_user_home', async () => {
    // A shell user could point the shim at any absolute path; the root worker
    // must never read outside /home/<user>/ (defense of the privilege seam).
    const outside = '/root/secret.torrent';
    c.meta.preload(outside, metainfo(true));

    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: outside,
    });

    expect(await c.torrents.findByInfoHash(alice, HASH)).toBeUndefined();
  });

  it('should_ignore_a_finished_event_whose_paths_escape_the_user_home', async () => {
    await c.handleEvent.execute({
      username: alice,
      event: 'finished',
      infoHash: HASH,
      name: 'x',
      basePath: '/home/bob/rtorrent/complete/x',
    });

    expect(await c.torrents.findByInfoHash(alice, HASH)).toBeUndefined();
    expect(c.scripts.runs).toHaveLength(0);
  });

  it('should_accept_a_private_torrent_and_record_it_loaded', async () => {
    c.meta.preload(TORRENT_FILE, metainfo(true));

    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: TORRENT_FILE,
      label: Label.parse('films'),
    });

    const torrent = await c.torrents.findByInfoHash(alice, HASH);
    expect(torrent?.state.value).toBe('loaded');
    expect(torrent?.label?.value).toBe('films');
    expect(torrent?.name).toBe('x'); // name from metainfo
  });

  it('should_reject_a_public_torrent_unless_the_user_flag_allows_it', async () => {
    c.meta.preload(TORRENT_FILE, metainfo(false));

    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: TORRENT_FILE,
    });

    expect((await c.torrents.findByInfoHash(alice, HASH))?.state.value).toBe('rejected');
    expect(c.control.stopped).toEqual([{ scgiPort: 51101, infoHash: HASH.value }]);

    await c.setAllowPublicTracker.execute({ username: alice, allowed: true });
    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: TORRENT_FILE,
    });
    expect((await c.torrents.findByInfoHash(alice, HASH))?.state.value).toBe('loaded');
  });

  it('should_still_record_the_rejection_when_rtorrent_control_fails', async () => {
    c.meta.preload(TORRENT_FILE, metainfo(false));
    c.control.failWith = new Error('scgi down');

    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: TORRENT_FILE,
    });

    expect((await c.torrents.findByInfoHash(alice, HASH))?.state.value).toBe('rejected');
  });

  it('should_complete_on_finished_and_fan_out_user_scripts', async () => {
    await c.handleEvent.execute({
      username: alice,
      event: 'finished',
      infoHash: HASH,
      name: 'x',
      basePath: '/home/alice/rtorrent/complete/x',
      directory: '/home/alice/rtorrent/complete',
      label: Label.parse('films'),
    });

    const torrent = await c.torrents.findByInfoHash(alice, HASH);
    expect(torrent?.state.value).toBe('completed');
    expect(torrent?.tree).toBe('/home/alice/rtorrent/complete/x');
    expect(c.scripts.runs).toEqual([
      {
        username: 'alice',
        basePath: '/home/alice/rtorrent/complete/x',
        directory: '/home/alice/rtorrent/complete',
        label: 'films',
        name: 'x',
      },
    ]);
  });

  it('should_respect_sync_disabled_by_skipping_the_fan_out', async () => {
    await c.setSyncDisabled.execute({ username: alice, disabled: true });

    await c.handleEvent.execute({
      username: alice,
      event: 'finished',
      infoHash: HASH,
      name: 'x',
      basePath: '/home/alice/rtorrent/complete/x',
    });

    expect((await c.torrents.findByInfoHash(alice, HASH))?.state.value).toBe('completed');
    expect(c.scripts.runs).toHaveLength(0);
  });

  it('should_delete_the_row_on_erased_idempotently', async () => {
    c.meta.preload(TORRENT_FILE, metainfo(true));
    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: TORRENT_FILE,
    });

    await c.handleEvent.execute({ username: alice, event: 'erased', infoHash: HASH });
    await c.handleEvent.execute({ username: alice, event: 'erased', infoHash: HASH });

    expect(await c.torrents.findByInfoHash(alice, HASH)).toBeUndefined();
  });

  it('should_require_a_provisioned_instance_for_events', async () => {
    await expect(
      c.handleEvent.execute({ username: Username.parse('ghost'), event: 'erased', infoHash: HASH }),
    ).rejects.toThrow(TorrentInstanceNotFoundError);
  });
});

describe('DeprovisionRtorrentInstance', () => {
  it('should_remove_unit_instance_and_torrent_rows_idempotently', async () => {
    await c.provision.execute({ username: alice });
    c.meta.preload(TORRENT_FILE, metainfo(true));
    await c.handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: TORRENT_FILE,
    });

    await c.deprovision.execute({ username: alice });
    await c.deprovision.execute({ username: alice }); // idempotent

    expect(c.services.unitContentFor(alice)).toBeUndefined();
    expect(await c.instances.findByUsername(alice)).toBeUndefined();
    expect(await c.torrents.listFor(alice)).toHaveLength(0);
  });
});
