import { describe, expect, it } from 'vitest';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { VolumeSpace } from '../../../../src/domain/user/VolumeSpace.js';
import type { VolumePort } from '../../../../src/domain/user/ports.js';
import { LoggedVolume } from '../../../../src/infrastructure/system/LoggedVolume.js';

function recordingLog(): { lines: unknown[][]; warn: (...args: unknown[]) => void } {
  const lines: unknown[][] = [];
  return { lines, warn: (...args) => { lines.push(args); } };
}

function volumeThat(outcome: () => Promise<VolumeSpace>): VolumePort {
  return { measure: outcome };
}

describe('an unreadable volume reaching the worker log', () => {
  // the hourly pass skips it and the portal keeps its last reading: the log is
  // the only place left to say why the disk line stopped moving
  it('should_log_the_failure_and_still_fail_the_reading', async () => {
    const log = recordingLog();
    const volume = new LoggedVolume(
      volumeThat(() => Promise.reject(new Error('statfs: no such file or directory'))),
      log,
    );

    await expect(volume.measure()).rejects.toThrow('statfs: no such file or directory');
    expect(log.lines).toEqual([
      [{ reason: 'statfs: no such file or directory' }, 'volume reading failed'],
    ]);
  });

  it('should_log_nothing_when_the_volume_is_read', async () => {
    const log = recordingLog();
    const space = VolumeSpace.of({ free: Quota.gib(900), size: Quota.gib(3200) });
    const volume = new LoggedVolume(volumeThat(() => Promise.resolve(space)), log);

    await expect(volume.measure()).resolves.toBe(space);
    expect(log.lines).toEqual([]);
  });
});
