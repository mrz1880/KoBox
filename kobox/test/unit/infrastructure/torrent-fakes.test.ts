import { describe, expect, it } from 'vitest';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { Label } from '../../../src/domain/torrent/Label.js';
import { WatchDir } from '../../../src/domain/torrent/WatchDir.js';
import type { RenderedFile } from '../../../src/domain/torrent/ports.js';
import { ScgiPort } from '../../../src/domain/user/Port.js';
import { Username } from '../../../src/domain/user/Username.js';
import { FakeRtorrentConfig } from '../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeRtorrentControl } from '../../../src/infrastructure/system/fakes/FakeRtorrentControl.js';
import { FakeServiceControl } from '../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeTorrentMetainfo } from '../../../src/infrastructure/system/fakes/FakeTorrentMetainfo.js';
import { FakeUserScriptRunner } from '../../../src/infrastructure/system/fakes/FakeUserScriptRunner.js';
import { FakeWatchDirs } from '../../../src/infrastructure/system/fakes/FakeWatchDirs.js';

const alice = Username.parse('alice');
const HASH = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');

function file(path: string, content: string): RenderedFile {
  return { path, content, mode: '0640', owner: 'root', group: 'alice' };
}

describe('FakeRtorrentConfig', () => {
  it('should_report_changed_files_and_be_idempotent_like_the_real_adapter', async () => {
    const fake = new FakeRtorrentConfig();
    expect(await fake.apply([file('/a', 'v1')])).toEqual(['/a']);
    expect(await fake.apply([file('/a', 'v1')])).toEqual([]);
    expect(await fake.apply([file('/a', 'v2')])).toEqual(['/a']);
    expect(fake.contentAt('/a')).toBe('v2');
  });
});

describe('FakeWatchDirs', () => {
  it('should_record_the_last_ensured_layout_per_user', async () => {
    const fake = new FakeWatchDirs();
    await fake.ensureLayout(alice, [WatchDir.root(), WatchDir.labeled(Label.parse('films'))]);
    expect(fake.layoutFor(alice).map((dir) => dir.label?.value)).toEqual([undefined, 'films']);
  });
});

describe('FakeServiceControl unit provisioning', () => {
  it('should_track_installed_units_restarts_and_removal', async () => {
    const fake = new FakeServiceControl();
    await fake.installUserService(alice, '[Unit]\nv1\n');
    expect(fake.unitContentFor(alice)).toBe('[Unit]\nv1\n');

    await fake.startUserService(alice);
    expect(await fake.isUserServiceRunning(alice)).toBe(true);

    await fake.restartUserService(alice);
    expect(fake.restartsFor(alice)).toBe(1);

    await fake.removeUserService(alice);
    expect(fake.unitContentFor(alice)).toBeUndefined();
    expect(await fake.isUserServiceRunning(alice)).toBe(false);
  });
});

describe('FakeTorrentMetainfo', () => {
  it('should_serve_preloaded_metainfo_and_undefined_otherwise', async () => {
    const fake = new FakeTorrentMetainfo();
    fake.preload('/tmp/x.torrent', {
      infoHash: HASH,
      name: 'x',
      isPrivate: true,
      announcers: [],
    });
    expect((await fake.read('/tmp/x.torrent'))?.name).toBe('x');
    expect(await fake.read('/tmp/missing.torrent')).toBeUndefined();
  });
});

describe('FakeRtorrentControl and FakeUserScriptRunner', () => {
  it('should_record_interactions', async () => {
    const control = new FakeRtorrentControl();
    await control.stopAndClose(ScgiPort.parse(51101), HASH);
    expect(control.stopped).toEqual([{ scgiPort: 51101, infoHash: HASH.value }]);

    const scripts = new FakeUserScriptRunner();
    await scripts.runFinishedScripts(alice, {
      basePath: '/b',
      directory: '/d',
      label: 'films',
      name: 'x',
    });
    expect(scripts.runs).toEqual([
      { username: 'alice', basePath: '/b', directory: '/d', label: 'films', name: 'x' },
    ]);
  });
});
