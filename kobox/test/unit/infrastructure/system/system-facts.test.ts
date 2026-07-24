import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SystemFactsAdapter } from '../../../../src/infrastructure/system/SystemFactsAdapter.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  private readonly results = new Map<string, CommandResult>();

  onCommand(command: string, result: Partial<CommandResult>): void {
    this.results.set(command, { stdout: '', stderr: '', exitCode: 0, ...result });
  }

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve(
      this.results.get(request.command) ?? { stdout: '', stderr: '', exitCode: 0 },
    );
  }
}

function fixtureOsRelease(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kobox-facts-'));
  const path = join(dir, 'os-release');
  writeFileSync(path, content);
  return path;
}

const DEBIAN_12 = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\nVERSION_ID="12"\n';

describe('SystemFactsAdapter', () => {
  it('should_gather_debian_facts_from_os_release_uname_findmnt_and_ip_route', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('uname', { stdout: 'x86_64\n' });
    runner.onCommand('findmnt', { stdout: 'ext4\n' });
    runner.onCommand('ip', { stdout: 'default via 192.0.2.1 dev eth0\n' });
    const adapter = new SystemFactsAdapter(runner, {
      osReleasePath: fixtureOsRelease(DEBIAN_12),
      tunDevicePath: '/nonexistent/tun',
    });

    const facts = await adapter.gather();

    expect(facts.osId).toBe('debian');
    expect(facts.osVersionId).toBe('12');
    expect(facts.arch).toBe('amd64');
    expect(facts.rootFsType).toBe('ext4');
    expect(facts.hasDefaultRoute).toBe(true);
    expect(facts.hasTunDevice).toBe(false);
    expect(facts.euid).toBe(process.geteuid?.() ?? -1);
    expect(runner.calls.map((c) => [c.command, ...c.args])).toEqual([
      ['uname', '-m'],
      ['findmnt', '-n', '-o', 'FSTYPE', '/'],
      ['ip', 'route', 'show', 'default'],
    ]);
  });

  it('should_map_aarch64_to_arm64_and_detect_missing_default_route', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('uname', { stdout: 'aarch64\n' });
    runner.onCommand('findmnt', { stdout: 'overlay\n' });
    runner.onCommand('ip', { stdout: '\n' });
    const adapter = new SystemFactsAdapter(runner, {
      osReleasePath: fixtureOsRelease(DEBIAN_12),
      tunDevicePath: '/nonexistent/tun',
    });

    const facts = await adapter.gather();

    expect(facts.arch).toBe('arm64');
    expect(facts.rootFsType).toBe('overlay');
    expect(facts.hasDefaultRoute).toBe(false);
  });

  it('should_report_unknown_os_when_os_release_is_unreadable', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('uname', { stdout: 'x86_64\n' });
    const adapter = new SystemFactsAdapter(runner, {
      osReleasePath: '/nonexistent/os-release',
      tunDevicePath: '/nonexistent/tun',
    });

    const facts = await adapter.gather();

    expect(facts.osId).toBe('unknown');
    expect(facts.osVersionId).toBe('unknown');
  });
});
