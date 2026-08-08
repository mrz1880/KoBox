import type { PackageUpdatePort } from '../../application/maintenance/DiagnosticsPort.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// apt in non-interactive mode: an upgrade that stops to ask a question would
// hang the worker until its timeout.
const APT_ENV = { DEBIAN_FRONTEND: 'noninteractive' } as const;
// the tail is what an operator reads after the fact; the whole log of a large
// upgrade is neither useful nor something to keep in the database
const OUTPUT_TAIL_LINES = 40;

export class AptUpdateAdapter implements PackageUpdatePort {
  constructor(private readonly runner: CommandRunner) {}

  async listUpgradable(): Promise<{ listing: string; count: number }> {
    await runOrThrow(this.runner, {
      command: 'apt-get',
      args: ['update', '-qq'],
      env: APT_ENV,
      timeoutMs: 180_000,
    });
    const result = await runOrThrow(this.runner, {
      command: 'apt',
      args: ['list', '--upgradable'],
      env: APT_ENV,
      timeoutMs: 60_000,
    });
    // apt prints a "Listing..." header line that is not a package
    const rows = result.stdout
      .split('\n')
      .filter((line) => line.includes('/') && line.includes('upgradable from'));
    return { listing: rows.join('\n'), count: rows.length };
  }

  async upgradeAll(): Promise<string> {
    const result = await runOrThrow(this.runner, {
      command: 'apt-get',
      args: ['upgrade', '-y', '-o', 'Dpkg::Options::=--force-confold'],
      env: APT_ENV,
      timeoutMs: 1_800_000,
    });
    return result.stdout.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
  }
}
