import { mkdirSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { UpgradeHostAdapter } from '../../../src/infrastructure/system/UpgradeHostAdapter.js';

let dir: string;
const adapter = new UpgradeHostAdapter(new ExecFileRunner());

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-upgrade-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('UpgradeHostAdapter symlink flip (real filesystem)', () => {
  it('should_answer_undefined_before_any_link_exists', async () => {
    expect(await adapter.currentTarget(join(dir, 'current'))).toBeUndefined();
  });

  it('should_create_then_atomically_replace_the_current_link', async () => {
    const link = join(dir, 'current');
    const releaseA = join(dir, 'releases', 'aaa');
    const releaseB = join(dir, 'releases', 'bbb');
    mkdirSync(releaseA, { recursive: true });
    mkdirSync(releaseB, { recursive: true });

    await adapter.switchCurrent(link, releaseA);
    expect(readlinkSync(link)).toBe(releaseA);
    expect(await adapter.currentTarget(link)).toBe(releaseA);

    await adapter.switchCurrent(link, releaseB);
    expect(readlinkSync(link)).toBe(releaseB);
    // no staging debris left behind
    expect(await adapter.currentTarget(`${link}.next`)).toBeUndefined();
  });

  it('should_recover_from_a_crashed_switch_leaving_a_stale_staging_link', async () => {
    const link = join(dir, 'current');
    const release = join(dir, 'releases', 'ccc');
    mkdirSync(release, { recursive: true });
    // simulate the crash: a stale .next from a previous attempt
    await adapter.switchCurrent(`${link}.next`, join(dir, 'stale-target'));

    await adapter.switchCurrent(link, release);

    expect(readlinkSync(link)).toBe(release);
  });
});
