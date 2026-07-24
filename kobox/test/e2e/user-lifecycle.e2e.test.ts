import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Full privilege-seam E2E on a fresh Debian 12: real CLI (unprivileged path:
// enqueue) -> real root worker -> real useradd/chpasswd/gpasswd/systemctl.
// Requires: pnpm build, root, systemd (make e2e runs it inside the container).

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const E2E_USER = 'e2euser';
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';

let env: NodeJS.ProcessEnv;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

function drainQueue(): void {
  sh('node', [WORKER, '--once']);
}

function passwdStatus(): string {
  return sh('passwd', ['-S', E2E_USER]).split(/\s+/)[1] ?? '?';
}


function groupsOf(): string[] {
  return sh('id', ['-nG', E2E_USER]).trim().split(/\s+/);
}

function unitState(): string {
  try {
    return sh('systemctl', ['is-active', `rtorrent-${E2E_USER}`]).trim();
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    return stdout?.trim() ?? 'unknown';
  }
}

function userExists(): boolean {
  try {
    sh('id', ['-u', E2E_USER], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!onDebianAsRoot)('E2E: create -> suspend -> resume -> delete', () => {
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-e2e-'));
    env = { ...process.env, KOBOX_DB: join(dir, 'kobox.db'), KOBOX_SPOOL: join(dir, 'events') };
    sh('bash', ['docker/e2e-setup.sh']);
    if (userExists()) {
      try {
        execFileSync('systemctl', ['disable', '--now', `rtorrent-${E2E_USER}`], { stdio: 'ignore' });
      } catch {
        // unit may not exist
      }
      execFileSync('userdel', ['-r', E2E_USER], { stdio: 'ignore' });
    }
  });

  it('should_provision_a_real_user_and_its_rtorrent_instance_from_typed_jobs', () => {
    const output = kobox(
      ['create-user', E2E_USER, '--email', 'e2euser@example.org', '--quota-gib', '10'],
      's3cretpw\n',
    );
    expect(output).toMatch(/job 1 enqueued/);
    expect(userExists()).toBe(false); // nothing happened yet: unprivileged path only enqueues

    drainQueue();

    expect(userExists()).toBe(true);
    expect(existsSync(`/home/${E2E_USER}`)).toBe(true);
    expect(groupsOf()).toEqual(expect.arrayContaining(['kobox-users', 'kobox-sftp']));
    expect(passwdStatus()).toBe('P');
    expect(sh('getent', ['shadow', E2E_USER])).toContain('$6$');
    // Phase 1: create-user chains provision-rtorrent — a REAL rtorrent runs
    expect(existsSync(`/home/${E2E_USER}/.rtorrent.rc`)).toBe(true);
    expect(unitState()).toBe('active');
  });

  it('should_suspend_reversibly_cutting_auth_sftp_and_rtorrent', () => {
    kobox(['suspend-user', E2E_USER]);
    drainQueue();

    expect(passwdStatus()).toBe('L'); // password auth refused
    const shadowExpiry = sh('getent', ['shadow', E2E_USER]).trim().split(':')[7];
    expect(shadowExpiry).toBe('1'); // account expired: pubkey SSH refused too
    expect(groupsOf()).not.toContain('kobox-sftp'); // chroot sftp gone
    expect(unitState()).not.toBe('active'); // rtorrent stopped
    expect(userExists()).toBe(true); // account intact
    expect(existsSync(`/home/${E2E_USER}`)).toBe(true); // data intact
  });

  it('should_resume_back_to_the_exact_previous_service_level', () => {
    kobox(['resume-user', E2E_USER]);
    drainQueue();

    expect(passwdStatus()).toBe('P');
    const shadowExpiry = sh('getent', ['shadow', E2E_USER]).trim().split(':')[7];
    expect(shadowExpiry ?? '').toBe(''); // expiry cleared: pubkey SSH restored
    expect(groupsOf()).toEqual(expect.arrayContaining(['kobox-users', 'kobox-sftp']));
    expect(unitState()).toBe('active');
  });

  it('should_report_health_as_json_via_doctor', () => {
    let output = '';
    try {
      output = kobox(['doctor']);
    } catch (error) {
      output = (error as { stdout?: string }).stdout ?? '';
    }
    const report = JSON.parse(output) as { healthy: boolean; checks: { name: string }[] };
    expect(typeof report.healthy).toBe('boolean');
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('should_delete_the_user_and_release_everything_including_the_unit', () => {
    kobox(['delete-user', E2E_USER]);
    drainQueue();

    expect(userExists()).toBe(false);
    expect(unitState()).not.toBe('active');
    // deprovision-rtorrent chained after delete-user: unit file removed
    expect(existsSync(`/etc/systemd/system/rtorrent-${E2E_USER}.service`)).toBe(false);
  });
});
