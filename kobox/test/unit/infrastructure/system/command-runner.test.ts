import { describe, expect, it } from 'vitest';
import { ExecFileRunner } from '../../../../src/infrastructure/system/CommandRunner.js';

// ExecFileRunner shells out for real here (node:child_process execFile with a
// harmless binary) — the env overlay is precisely the part a fake cannot prove.
describe('ExecFileRunner', () => {
  it('should_pass_the_env_overlay_to_the_child_process', async () => {
    const runner = new ExecFileRunner();

    const result = await runner.run({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.KOBOX_TEST_OVERLAY ?? "missing")'],
      env: { KOBOX_TEST_OVERLAY: 'reached-the-child' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('reached-the-child');
  });

  it('should_keep_the_parent_environment_visible_under_an_overlay', async () => {
    const runner = new ExecFileRunner();

    const result = await runner.run({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.PATH ?? "missing")'],
      env: { KOBOX_TEST_OVERLAY: '1' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toBe('missing');
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('should_run_without_an_overlay_exactly_as_before', async () => {
    const runner = new ExecFileRunner();

    const result = await runner.run({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("plain")'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('plain');
  });
});
