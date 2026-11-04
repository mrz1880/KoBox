import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The dev and CI container is privileged, so it shares the kernel of the
// machine running it, binfmt_misc included. Docker Desktop registers Rosetta
// there, and the CI runner its own emulators. systemd-binfmt flushes every
// entry of that table when it starts and again when it stops: left enabled, each
// boot of this container broke amd64 emulation for everything else on the host.
function hasSystemd(): boolean {
  try {
    execFileSync('systemctl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// `systemctl is-enabled` exits non-zero for a masked unit, so read its output
// rather than its status.
function enablement(unit: string): string {
  try {
    return execFileSync('systemctl', ['is-enabled', unit], { encoding: 'utf8' }).trim();
  } catch (error) {
    const { stdout } = error as { stdout?: string };
    return (stdout ?? '').trim();
  }
}

describe('the dev container', () => {
  it.skipIf(!hasSystemd())('should_leave_the_host_binary_formats_alone', () => {
    expect(enablement('systemd-binfmt.service')).toBe('masked');
  });
});
