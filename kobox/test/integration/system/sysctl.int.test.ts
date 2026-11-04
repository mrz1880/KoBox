import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMemberPortReservation } from '../../../src/domain/installation/rendering.js';
import { RtorrentPort, ScgiPort } from '../../../src/domain/user/Port.js';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { SysctlAdapter } from '../../../src/infrastructure/system/SysctlAdapter.js';

// Loading a sysctl changes the running kernel (of the container's network
// namespace here): confined to the privileged dev container like every suite
// that mutates the host.
const inContainerAsRoot =
  process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/.dockerenv');

const KEY = 'net.ipv4.ip_local_reserved_ports';

function reservedNow(): string {
  return execFileSync('sysctl', ['-n', KEY], { encoding: 'utf8' }).trim();
}

describe.runIf(inContainerAsRoot)('SysctlAdapter (real sysctl)', () => {
  let dir: string;
  let before: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-sysctl-'));
    before = reservedNow();
  });

  afterAll(() => {
    execFileSync('sysctl', ['-qw', `${KEY}=${before}`]);
    rmSync(dir, { recursive: true, force: true });
  });

  // the content KoBox renders, at a path of the test's own
  async function load(content: string): Promise<void> {
    const path = join(dir, 'reservation.conf');
    writeFileSync(path, content);
    await new SysctlAdapter(new ExecFileRunner()).load(path);
  }

  it('should_reserve_the_rendered_ports_in_the_running_kernel', async () => {
    await load(
      renderMemberPortReservation([
        RtorrentPort.parse(45000),
        RtorrentPort.parse(45001),
        ScgiPort.parse(51101),
      ]).content,
    );

    expect(reservedNow()).toBe('45000-45001,51101');
  });

  it('should_empty_the_reservation_when_the_rendered_file_holds_no_port', async () => {
    await load(renderMemberPortReservation([ScgiPort.parse(51101)]).content);

    await load(renderMemberPortReservation([]).content);

    expect(reservedNow()).toBe('');
  });
});
