import type { PackagePort } from '../../domain/installation/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const APT_TIMEOUT_MS = 600_000; // bundles can legitimately take minutes
const QUERY_TIMEOUT_MS = 30_000;
const NONINTERACTIVE = { DEBIAN_FRONTEND: 'noninteractive' } as const;

export class AptPackageAdapter implements PackagePort {
  constructor(private readonly runner: CommandRunner) {}

  async refresh(): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'apt-get',
      args: ['update'],
      env: NONINTERACTIVE,
      timeoutMs: APT_TIMEOUT_MS,
    });
  }

  async ensureInstalled(packages: readonly string[]): Promise<void> {
    const missing: string[] = [];
    for (const pkg of packages) {
      if (!(await this.isInstalled(pkg))) {
        missing.push(pkg);
      }
    }
    if (missing.length === 0) {
      return;
    }
    await runOrThrow(this.runner, {
      command: 'apt-get',
      args: ['install', '-y', '--no-install-recommends', ...missing],
      env: NONINTERACTIVE,
      timeoutMs: APT_TIMEOUT_MS,
    });
  }

  async isAvailable(pkg: string): Promise<boolean> {
    const result = await this.runner.run({
      command: 'apt-cache',
      args: ['policy', pkg],
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      return false;
    }
    const candidate = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('Candidate:'));
    return candidate !== undefined && !candidate.includes('(none)');
  }

  async isInstalled(pkg: string): Promise<boolean> {
    const result = await this.runner.run({
      command: 'dpkg-query',
      args: ['-W', '-f', '${db:Status-Status}', pkg],
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    return result.exitCode === 0 && result.stdout.trim() === 'installed';
  }

  async installedVersion(pkg: string): Promise<string | undefined> {
    const result = await this.runner.run({
      command: 'dpkg-query',
      args: ['-W', '-f', '${Version}', pkg],
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    const version = result.stdout.trim();
    return result.exitCode === 0 && version !== '' ? version : undefined;
  }
}
