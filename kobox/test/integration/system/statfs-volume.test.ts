import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatfsVolumeAdapter } from '../../../src/infrastructure/system/StatfsVolumeAdapter.js';

const KIB = 1024;
// df rounds to the KiB and the disk keeps moving under a running test suite
const TOLERANCE_BYTES = 64 * KIB * KIB;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-volume-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// df's columns for the filesystem holding a path, in bytes: what an
// administrator reads at the shell, and what the portal must agree with
function dfOf(path: string): { readonly sizeBytes: number; readonly availableBytes: number } {
  const lines = execFileSync('df', ['-Pk', path], { encoding: 'utf8' }).trim().split('\n');
  const columns = (lines.at(-1) ?? '').trim().split(/\s+/);
  return {
    sizeBytes: Number(columns[1]) * KIB,
    availableBytes: Number(columns[3]) * KIB,
  };
}

describe('StatfsVolumeAdapter', () => {
  // free means what an ordinary account can still write, as df's "Available"
  // says, not the blocks only root may use
  it('should_read_the_size_and_the_space_a_member_can_still_write_as_df_does', async () => {
    const space = await new StatfsVolumeAdapter(dir).measure();

    const df = dfOf(dir);
    expect(Math.abs(space.size.toBytes() - df.sizeBytes)).toBeLessThan(TOLERANCE_BYTES);
    expect(Math.abs(space.free.toBytes() - df.availableBytes)).toBeLessThan(TOLERANCE_BYTES);
  });

  it('should_fail_on_a_path_that_does_not_exist', async () => {
    await expect(new StatfsVolumeAdapter(join(dir, 'missing')).measure()).rejects.toThrow();
  });
});
