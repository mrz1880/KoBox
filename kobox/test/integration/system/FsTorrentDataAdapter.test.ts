import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathOutsideMemberSpaceError } from '../../../src/domain/space/PathOutsideMemberSpaceError.js';
import { Username } from '../../../src/domain/user/Username.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../src/infrastructure/system/CommandRunner.js';
import { FsTorrentDataAdapter } from '../../../src/infrastructure/system/FsTorrentDataAdapter.js';

// The adapter erases through `runuser -u <member> -- rm -rf --one-file-system`,
// which needs root and GNU rm. Here the test user plays the member: the path
// the adapter hands over is removed the way that rm would remove it.
const EXPECTED_ERASE = ['rm', '-rf', '--one-file-system', '--'];

class ActingAsTheMember implements CommandRunner {
  run(request: CommandRequest): Promise<CommandResult> {
    const erase = request.args.slice(request.args.indexOf('--') + 1);
    if (request.command !== 'runuser' || erase.slice(0, -1).join(' ') !== EXPECTED_ERASE.join(' ')) {
      throw new Error(`unexpected command ${request.command} ${request.args.join(' ')}`);
    }
    rmSync(erase.at(-1) ?? '', { recursive: true, force: true });
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

const alice = Username.parse('alice');

let sandbox: string;
let downloads: string;
let adapter: FsTorrentDataAdapter;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kobox-torrent-data-'));
  downloads = join(sandbox, 'alice', 'rtorrent', 'complete');
  mkdirSync(downloads, { recursive: true });
  adapter = new FsTorrentDataAdapter(new ActingAsTheMember(), () => downloads);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('FsTorrentDataAdapter', () => {
  it('should_remove_a_single_file_torrent_from_the_member_downloads', async () => {
    const file = join(downloads, 'debian-13.iso');
    writeFileSync(file, 'iso');

    await adapter.remove(alice, file);

    expect(existsSync(file)).toBe(false);
  });

  it('should_remove_a_multi_file_torrent_folder_with_everything_in_it', async () => {
    const folder = join(downloads, 'films', 'Big Buck Bunny');
    mkdirSync(join(folder, 'extras'), { recursive: true });
    writeFileSync(join(folder, 'movie.mkv'), 'movie');
    writeFileSync(join(folder, 'extras', 'trailer.mkv'), 'trailer');

    await adapter.remove(alice, folder);

    expect(existsSync(folder)).toBe(false);
    expect(existsSync(join(downloads, 'films'))).toBe(true);
  });

  it('should_refuse_a_path_outside_the_member_downloads_and_leave_it_alone', async () => {
    const keys = join(sandbox, 'alice', '.ssh', 'authorized_keys');
    mkdirSync(join(sandbox, 'alice', '.ssh'));
    writeFileSync(keys, 'ssh-ed25519 AAAA alice@example.org');

    await expect(adapter.remove(alice, keys)).rejects.toThrow(PathOutsideMemberSpaceError);
    expect(existsSync(keys)).toBe(true);
  });

  it('should_refuse_a_path_that_climbs_out_of_the_downloads_with_dot_dot', async () => {
    const rc = join(sandbox, 'alice', '.rtorrent.rc');
    writeFileSync(rc, 'directory.default.set = /');

    await expect(adapter.remove(alice, `${downloads}/../../.rtorrent.rc`)).rejects.toThrow(
      PathOutsideMemberSpaceError,
    );
    expect(existsSync(rc)).toBe(true);
  });

  it('should_refuse_a_path_whose_parent_is_a_link_leading_out_of_the_downloads', async () => {
    const bobHome = join(sandbox, 'bob');
    mkdirSync(bobHome);
    writeFileSync(join(bobHome, 'notes.txt'), 'bob');
    symlinkSync(bobHome, join(downloads, 'shortcut'));

    const throughLink = join(downloads, 'shortcut', 'notes.txt');

    await expect(adapter.remove(alice, throughLink)).rejects.toThrow(PathOutsideMemberSpaceError);
    expect(existsSync(join(bobHome, 'notes.txt'))).toBe(true);
  });

  it('should_refuse_the_downloads_folder_itself', async () => {
    writeFileSync(join(downloads, 'debian-13.iso'), 'iso');

    await expect(adapter.remove(alice, `${downloads}/`)).rejects.toThrow(
      PathOutsideMemberSpaceError,
    );
    expect(existsSync(join(downloads, 'debian-13.iso'))).toBe(true);
  });

  it('should_remove_a_symbolic_link_itself_and_never_what_it_points_to', async () => {
    const bobFiles = join(sandbox, 'bob', 'films');
    mkdirSync(bobFiles, { recursive: true });
    writeFileSync(join(bobFiles, 'movie.mkv'), 'bob');
    const link = join(downloads, 'Big Buck Bunny');
    symlinkSync(bobFiles, link);

    await adapter.remove(alice, link);

    expect(() => lstatSync(link)).toThrow();
    expect(existsSync(join(bobFiles, 'movie.mkv'))).toBe(true);
  });

  it('should_count_an_already_missing_path_as_removed', async () => {
    await expect(adapter.remove(alice, join(downloads, 'debian-13.iso'))).resolves.toBeUndefined();
  });

  it('should_count_a_path_whose_folder_is_gone_too_as_removed', async () => {
    const path = join(downloads, 'films', 'Big Buck Bunny', 'movie.mkv');

    await expect(adapter.remove(alice, path)).resolves.toBeUndefined();
  });

  it('should_still_refuse_a_missing_path_outside_the_downloads', async () => {
    const path = join(sandbox, 'bob', 'films', 'movie.mkv');

    await expect(adapter.remove(alice, path)).rejects.toThrow(PathOutsideMemberSpaceError);
  });
});
