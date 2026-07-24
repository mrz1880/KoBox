import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import {
  UnresolvedPlaceholderError,
  renderHomeFiles,
  renderTemplate,
  renderUnit,
} from '../../../../src/domain/torrent/rendering.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { loadRtorrentTemplates } from '../../../../src/infrastructure/templates/TemplateProvider.js';

// Golden files: byte-for-byte expected renders, reviewed at diff time.
// Regenerate deliberately with: UPDATE_GOLDEN=1 pnpm test:unit
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/rtorrent');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

const templates = loadRtorrentTemplates();
const settings = { koboxBin: '/usr/local/bin/kobox' };

function aliceInstance(): TorrentInstance {
  const { instance } = TorrentInstance.provision({
    username: Username.parse('alice'),
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45001),
  });
  return instance.addWatchDir(Label.parse('films')).instance.addWatchDir(Label.parse('series'))
    .instance;
}

describe('renderTemplate', () => {
  it('should_substitute_every_placeholder', () => {
    expect(renderTemplate('a {{x}} b {{y}}', { x: '1', y: '2' })).toBe('a 1 b 2');
  });

  it('should_fail_loudly_on_unresolved_placeholders', () => {
    expect(() => renderTemplate('a {{x}} {{missing}}', { x: '1' })).toThrow(
      UnresolvedPlaceholderError,
    );
  });

  it('should_fail_loudly_on_unused_variables', () => {
    expect(() => renderTemplate('a {{x}}', { x: '1', unused: '2' })).toThrow(
      UnresolvedPlaceholderError,
    );
  });
});

describe('renderHomeFiles', () => {
  it('should_render_the_five_managed_files_with_strict_ownership', () => {
    const files = renderHomeFiles(aliceInstance(), templates, settings);
    expect(files.map((file) => file.path)).toEqual([
      '/home/alice/.rtorrent.rc',
      '/home/alice/rtorrent/config.d/80-watch.rc',
      '/home/alice/.rTorrent_inserted_new.sh',
      '/home/alice/.rTorrent_finished.sh',
      '/home/alice/.rTorrent_erased.sh',
    ]);
    for (const file of files) {
      expect(file.owner).toBe('root'); // user must not be able to edit managed files
      expect(file.group).toBe('alice');
    }
    expect(files[0]?.mode).toBe('0640');
    expect(files[2]?.mode).toBe('0750'); // shims are executable
  });

  it('should_be_deterministic', () => {
    const first = renderHomeFiles(aliceInstance(), templates, settings);
    const second = renderHomeFiles(aliceInstance(), templates, settings);
    expect(second).toEqual(first);
  });

  it('should_match_the_golden_rtorrent_rc', () => {
    const files = renderHomeFiles(aliceInstance(), templates, settings);
    expectGolden('rtorrent.rc.golden', files[0]?.content ?? '');
  });

  it('should_match_the_golden_watch_rc_with_one_schedule_per_watch_dir', () => {
    const files = renderHomeFiles(aliceInstance(), templates, settings);
    const watchRc = files[1]?.content ?? '';
    expect(watchRc).toContain('watch_directory_0');
    expect(watchRc).toContain('/home/alice/rtorrent/watch/films/*.torrent');
    expect(watchRc).toContain('d.custom1.set=series');
    expectGolden('80-watch.rc.golden', watchRc);
  });

  it('should_match_the_golden_event_shims', () => {
    const files = renderHomeFiles(aliceInstance(), templates, settings);
    expectGolden('shim-inserted_new.sh.golden', files[2]?.content ?? '');
    expectGolden('shim-finished.sh.golden', files[3]?.content ?? '');
    expectGolden('shim-erased.sh.golden', files[4]?.content ?? '');
  });
});

describe('renderUnit', () => {
  it('should_match_the_golden_systemd_unit', () => {
    expectGolden('rtorrent-user.service.golden', renderUnit(aliceInstance(), templates));
  });
});
