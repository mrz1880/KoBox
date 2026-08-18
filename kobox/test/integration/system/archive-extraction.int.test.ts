import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InstallHostAdapter } from '../../../src/infrastructure/system/InstallHostAdapter.js';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';

// Real archives, real tar. The point is the compression, and only a real file
// can settle whether the adapter can open it.
function makeArchive(dir: string, name: string, flag: string): string {
  const src = join(dir, 'src', 'nextcloud');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'occ'), '#!/usr/bin/env php\n');
  const archive = join(dir, name);
  execFileSync('tar', [flag, archive, '-C', join(dir, 'src'), 'nextcloud']);
  return archive;
}

// bzip2 is not on a Debian 12 minimal, which is exactly why the Nextcloud
// component installs it. Where it is absent this file cannot even build the
// fixture, so it says so rather than passing on a machine that proves nothing.
function hasBzip2(): boolean {
  try {
    execFileSync('bzip2', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('extracting a vendored release', () => {
  it.skipIf(!hasBzip2())('should_open_the_bzip2_archive_nextcloud_actually_publishes', async () => {
    // Nextcloud ships .tar.bz2 and .zip, never .tar.gz. `tar -xzf` refuses the
    // former outright, so the component could never have installed a real
    // release: the E2E only ever exercised its honest skip.
    const dir = mkdtempSync(join(tmpdir(), 'kobox-archive-'));
    const archive = makeArchive(dir, 'nextcloud.tar.bz2', '-cjf');
    const dest = join(dir, 'dest');
    mkdirSync(dest, { recursive: true });
    const host = new InstallHostAdapter(new ExecFileRunner());

    await host.extractArchive(archive, dest, 'inside-one-directory');

    expect(readdirSync(dest)).toContain('occ');
  });

  it('should_still_open_the_gzip_archives_the_other_components_pin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-archive-'));
    const archive = makeArchive(dir, 'rutorrent.tar.gz', '-czf');
    const dest = join(dir, 'dest');
    mkdirSync(dest, { recursive: true });
    const host = new InstallHostAdapter(new ExecFileRunner());

    await host.extractArchive(archive, dest, 'inside-one-directory');

    expect(readdirSync(dest)).toContain('occ');
  });
});
