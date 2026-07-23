import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { ProcessSocketHealthProbe } from '../../../../src/infrastructure/system/ProcessSocketHealthProbe.js';
import { QuotaAdapter } from '../../../../src/infrastructure/system/QuotaAdapter.js';
import { SftpAdapter } from '../../../../src/infrastructure/system/SftpAdapter.js';
import { SystemAccountAdapter } from '../../../../src/infrastructure/system/SystemAccountAdapter.js';
import { SystemdServiceControlAdapter } from '../../../../src/infrastructure/system/SystemdServiceControlAdapter.js';
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

  argvOf(command: string): readonly string[] | undefined {
    return this.calls.find((c) => c.command === command)?.args;
  }
}

const user-f = Username.parse('user-f');
const aHash = HashedPassword.parse('$6$testsalt$0123456789abcdefghijklmnopqrstuv');

describe('SystemAccountAdapter', () => {
  it('should_create_an_account_with_home_shell_and_group_via_argv_only', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemAccountAdapter(runner);

    await adapter.createAccount(user-f);

    expect(runner.argvOf('groupadd')).toEqual(['-f', 'kobox-users']);
    expect(runner.argvOf('useradd')).toEqual([
      '-m',
      '-s',
      '/bin/bash',
      '-G',
      'kobox-users',
      'user-f',
    ]);
  });

  it('should_set_the_password_hash_through_chpasswd_stdin_never_argv', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemAccountAdapter(runner);

    await adapter.setPassword(user-f, aHash);

    const call = runner.calls.find((c) => c.command === 'chpasswd');
    expect(call?.args).toEqual(['-e']);
    expect(call?.stdin).toBe(`user-f:${aHash.value}\n`);
  });

  it('should_lock_and_unlock_with_usermod', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemAccountAdapter(runner);

    await adapter.lockAccount(user-f);
    await adapter.unlockAccount(user-f);

    expect(runner.calls.map((c) => [c.command, ...c.args].join(' '))).toContain('usermod -L user-f');
    expect(runner.calls.map((c) => [c.command, ...c.args].join(' '))).toContain('usermod -U user-f');
  });

  it('should_report_lock_state_from_passwd_S', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('passwd', { stdout: 'user-f L 07/23/2026 0 99999 7 -1\n' });
    const adapter = new SystemAccountAdapter(runner);

    expect(await adapter.isLocked(user-f)).toBe(true);
  });

  it('should_fail_loudly_when_a_command_exits_non_zero', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('useradd', { exitCode: 9, stderr: 'useradd: user exists' });
    const adapter = new SystemAccountAdapter(runner);

    await expect(adapter.createAccount(user-f)).rejects.toThrow(/useradd.*exit 9/);
  });
});

describe('QuotaAdapter', () => {
  it('should_set_block_quota_in_kib_on_the_configured_filesystem', async () => {
    const runner = new RecordingRunner();
    const adapter = new QuotaAdapter(runner, '/home');

    await adapter.setQuota(user-f, Quota.gib(412));

    expect(runner.argvOf('setquota')).toEqual([
      '-u',
      'user-f',
      '0',
      String(412 * 1024 * 1024),
      '0',
      '0',
      '/home',
    ]);
  });

  it('should_parse_usage_from_quota_output', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('quota', {
      stdout:
        'Disk quotas for user user-f (uid 1006):\n' +
        '     Filesystem   blocks    quota    limit   grace   files   quota   limit   grace\n' +
        '      /dev/sda4  382730240  0  432013312       0  118292       0       0        \n',
      exitCode: 0,
    });
    const adapter = new QuotaAdapter(runner, '/home');

    const usage = await adapter.getUsage(user-f);

    expect(usage.toBytes()).toBe(382730240 * 1024);
  });
});

describe('SftpAdapter', () => {
  it('should_manage_membership_of_the_sftp_chroot_group', async () => {
    const runner = new RecordingRunner();
    const adapter = new SftpAdapter(runner);

    await adapter.enableChrootAccess(user-f);
    await adapter.disableChrootAccess(user-f);

    expect(runner.argvOf('usermod')).toEqual(['-aG', 'kobox-sftp', 'user-f']);
    expect(runner.argvOf('gpasswd')).toEqual(['-d', 'user-f', 'kobox-sftp']);
  });

  it('should_report_chroot_access_from_group_membership', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('id', { stdout: 'user-f kobox-users kobox-sftp\n' });
    const adapter = new SftpAdapter(runner);

    expect(await adapter.isChrootAccessEnabled(user-f)).toBe(true);
  });
});

describe('SystemdServiceControlAdapter', () => {
  it('should_drive_the_per_user_rtorrent_unit', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemdServiceControlAdapter(runner);

    await adapter.stopUserService(user-f);
    await adapter.startUserService(user-f);

    const lines = runner.calls.map((c) => [c.command, ...c.args].join(' '));
    expect(lines).toContain('systemctl stop rtorrent-user-f');
    expect(lines).toContain('systemctl start rtorrent-user-f');
  });

  it('should_treat_is_active_exit_code_as_running_state', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('systemctl', { exitCode: 3 });
    const adapter = new SystemdServiceControlAdapter(runner);

    expect(await adapter.isUserServiceRunning(user-f)).toBe(false);
  });
});

describe('ProcessSocketHealthProbe', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
  });

  it('should_report_a_listening_socket_as_healthy', async () => {
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const probe = new ProcessSocketHealthProbe(new RecordingRunner());

    const result = await probe.checkSocket('127.0.0.1', address.port);

    expect(result.state).toBe('healthy');
  });

  it('should_report_a_closed_socket_as_unhealthy', async () => {
    const probe = new ProcessSocketHealthProbe(new RecordingRunner());

    const result = await probe.checkSocket('127.0.0.1', 1);

    expect(result.state).toBe('unhealthy');
  });

  it('should_check_processes_with_pgrep_exact_match', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('pgrep', { exitCode: 1 });
    const probe = new ProcessSocketHealthProbe(runner);

    const result = await probe.checkProcess('rtorrent');

    expect(runner.argvOf('pgrep')).toEqual(['-x', 'rtorrent']);
    expect(result.state).toBe('unhealthy');
  });
});
