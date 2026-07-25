import { mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import type { UpgradeHostPort } from '../../application/maintenance/UpgradeHostPort.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const INSTALL_TIMEOUT_MS = 600_000;
const BUILD_TIMEOUT_MS = 300_000;
const MIGRATE_TIMEOUT_MS = 120_000;
const RESTART_TIMEOUT_MS = 30_000;
const VERIFY_ATTEMPTS = 10;
const VERIFY_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class UpgradeHostAdapter implements UpgradeHostPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly nodeBin: string = process.execPath,
  ) {}

  async buildRelease(path: string): Promise<void> {
    // pnpm --dir keeps the call argv-only; exit codes propagate (§5.6)
    await runOrThrow(this.runner, {
      command: 'pnpm',
      args: ['--dir', path, 'install', '--frozen-lockfile', '--prod=false'],
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    await runOrThrow(this.runner, {
      command: 'pnpm',
      args: ['--dir', path, 'build'],
      timeoutMs: BUILD_TIMEOUT_MS,
    });
  }

  async migrateWith(path: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: this.nodeBin,
      args: [`${path}/dist/interfaces/cli/main.js`, 'migrate'],
      timeoutMs: MIGRATE_TIMEOUT_MS,
    });
  }

  async currentTarget(link: string): Promise<string | undefined> {
    return readlink(link).then(
      (target) => target,
      () => undefined,
    );
  }

  async switchCurrent(link: string, target: string): Promise<void> {
    // symlink at a temp path + rename(2) over the link: readers always see
    // either the old or the new target, never a missing one
    await mkdir(link.slice(0, link.lastIndexOf('/')), { recursive: true });
    const staging = `${link}.next`;
    // a leftover staging link from a crashed switch must not block us
    await rm(staging, { force: true });
    await symlink(target, staging);
    await rename(staging, link);
  }

  async restartWorkerAndVerify(): Promise<boolean> {
    const restart = await this.runner.run({
      command: 'systemctl',
      args: ['restart', 'kobox-worker'],
      timeoutMs: RESTART_TIMEOUT_MS,
    });
    if (restart.exitCode !== 0) {
      return false;
    }
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
      const status = await this.runner.run({
        command: 'systemctl',
        args: ['is-active', '--quiet', 'kobox-worker'],
        timeoutMs: 10_000,
      });
      if (status.exitCode === 0) {
        return true;
      }
      await sleep(VERIFY_DELAY_MS);
    }
    return false;
  }
}
