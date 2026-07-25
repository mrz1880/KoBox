import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { SystemFacts, SystemFactsPort } from '../../domain/installation/ports.js';
import type { CommandRunner } from './CommandRunner.js';

const ARCH_BY_MACHINE: Readonly<Record<string, string>> = {
  x86_64: 'amd64',
  aarch64: 'arm64',
};

interface FactsPaths {
  readonly osReleasePath: string;
  readonly tunDevicePath: string;
}

const DEFAULT_PATHS: FactsPaths = {
  osReleasePath: '/etc/os-release',
  tunDevicePath: '/dev/net/tun',
};

function parseOsRelease(content: string): { osId: string; osVersionId: string } {
  const fields = new Map<string, string>();
  for (const line of content.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      fields.set(line.slice(0, eq), line.slice(eq + 1).replaceAll('"', ''));
    }
  }
  return {
    osId: fields.get('ID') ?? 'unknown',
    osVersionId: fields.get('VERSION_ID') ?? 'unknown',
  };
}

// Everything here is read-only: the whole point is to refuse mutation on the
// wrong box. Failures to read facts surface as 'unknown' values that the
// preflight then rejects with an actionable message.
export class SystemFactsAdapter implements SystemFactsPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly paths: FactsPaths = DEFAULT_PATHS,
  ) {}

  async gather(): Promise<SystemFacts> {
    const osRelease = await readFile(this.paths.osReleasePath, 'utf8').catch(() => '');
    const { osId, osVersionId } = parseOsRelease(osRelease);
    const machine = (await this.stdout('uname', ['-m'])).trim();
    const rootFsType = (await this.stdout('findmnt', ['-n', '-o', 'FSTYPE', '/'])).trim();
    const defaultRoute = (await this.stdout('ip', ['route', 'show', 'default'])).trim();
    return {
      osId,
      osVersionId,
      arch: ARCH_BY_MACHINE[machine] ?? machine,
      euid: process.geteuid?.() ?? -1,
      rootFsType,
      hasDefaultRoute: defaultRoute.length > 0,
      hasTunDevice: existsSync(this.paths.tunDevicePath),
    };
  }

  private async stdout(command: string, args: readonly string[]): Promise<string> {
    const result = await this.runner.run({ command, args: [...args], timeoutMs: 10_000 });
    return result.exitCode === 0 ? result.stdout : '';
  }
}
