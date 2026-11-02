import { describe, expect, it } from 'vitest';
import { restartKitTrees } from '../../../../src/domain/torrent/RestartKit.js';
import { CONFIG_DROP_IN_TREE, FINISH_SCRIPTS_TREE } from '../../../../src/domain/torrent/memberTrees.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { SessionDir } from '../../../../src/domain/torrent/SessionDir.js';
import { WatchDir } from '../../../../src/domain/torrent/WatchDir.js';

const HOME = '/home/alice';

function covers(path: string): boolean {
  return restartKitTrees().some((tree) => `${path}/`.startsWith(underHome(tree)));
}

function underHome(tree: string): string {
  return `${HOME}/${tree}/`;
}

describe('restart kit', () => {
  it('should_hold_the_session_rtorrent_reloads_its_torrent_list_from', () => {
    expect(restartKitTrees().map(underHome)).toContain(SessionDir.forHome(HOME).value);
  });

  it.each([
    ['root', WatchDir.root()],
    ['labeled', WatchDir.labeled(Label.parse('films'))],
  ])('should_hold_the_kept_torrents_of_the_%s_watch_dir', (_kind, dir) => {
    expect(covers(dir.torrentsPath(HOME))).toBe(true);
  });

  it.each([
    ['rtorrent_drop_ins', CONFIG_DROP_IN_TREE],
    ['finish_scripts', FINISH_SCRIPTS_TREE],
  ])('should_hold_the_member_own_%s', (_what, tree) => {
    expect(covers(`${HOME}/${tree}`)).toBe(true);
  });

  it.each([
    ['downloads', WatchDir.root().completePath(HOME)],
    ['watch_folder', WatchDir.root().watchPath(HOME)],
  ])('should_leave_the_%s_out', (_what, path) => {
    expect(covers(path)).toBe(false);
  });
});
