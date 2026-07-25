import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigCheckAdapter } from '../../../../src/infrastructure/system/ConfigCheckAdapter.js';
import { InstallHostAdapter } from '../../../../src/infrastructure/system/InstallHostAdapter.js';
import { SystemdAdapter } from '../../../../src/infrastructure/system/SystemdAdapter.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  private readonly handlers: ((request: CommandRequest) => CommandResult | undefined)[] = [];

  on(handler: (request: CommandRequest) => CommandResult | undefined): void {
    this.handlers.push(handler);
  }

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    for (const handler of this.handlers) {
      const result = handler(request);
      if (result) {
        return Promise.resolve(result);
      }
    }
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }

  argvs(): readonly string[] {
    return this.calls.map((c) => [c.command, ...c.args].join(' '));
  }
}

describe('SystemdAdapter', () => {
  it('should_map_operations_to_argv_only_systemctl_calls', async () => {
    const runner = new RecordingRunner();
    const systemd = new SystemdAdapter(runner);

    await systemd.daemonReload();
    await systemd.enable('kobox-worker', { now: true });
    await systemd.enable('kobox-firewall');
    await systemd.disable('dnscrypt-proxy.socket', { now: true });
    await systemd.start('openvpn-server@kobox-tun');
    await systemd.reloadOrRestart('ssh');

    expect(runner.argvs()).toEqual([
      'systemctl daemon-reload',
      'systemctl enable --now kobox-worker',
      'systemctl enable kobox-firewall',
      'systemctl disable --now dnscrypt-proxy.socket',
      'systemctl start openvpn-server@kobox-tun',
      'systemctl reload-or-restart ssh',
    ]);
  });

  it('should_answer_is_active_from_the_exit_code', async () => {
    const runner = new RecordingRunner();
    runner.on((r) =>
      r.args.includes('nginx') ? undefined : { stdout: '', stderr: '', exitCode: 3 },
    );
    const systemd = new SystemdAdapter(runner);

    expect(await systemd.isActive('nginx')).toBe(true);
    expect(await systemd.isActive('named')).toBe(false);
  });

  it('should_tolerate_disabling_an_absent_unit', async () => {
    const runner = new RecordingRunner();
    runner.on(() => ({ stdout: '', stderr: 'unit does not exist', exitCode: 1 }));
    const systemd = new SystemdAdapter(runner);

    // uninstall must converge even when a unit was never installed
    await expect(systemd.disable('pgl', { now: true })).resolves.toBeUndefined();
  });
});

describe('ConfigCheckAdapter', () => {
  it('should_run_the_service_native_checkers', async () => {
    const runner = new RecordingRunner();
    const checks = new ConfigCheckAdapter(runner);

    expect(await checks.sshd()).toEqual({ ok: true });
    expect(await checks.nginx()).toEqual({ ok: true });
    expect(await checks.bind()).toEqual({ ok: true });
    expect(runner.argvs()).toEqual(['sshd -t', 'nginx -t', 'named-checkconf']);
  });

  it('should_surface_the_checker_stderr_on_failure', async () => {
    const runner = new RecordingRunner();
    runner.on((r) =>
      r.command === 'sshd'
        ? { stdout: '', stderr: 'Bad configuration option: Nope', exitCode: 255 }
        : undefined,
    );
    const checks = new ConfigCheckAdapter(runner);

    expect(await checks.sshd()).toEqual({
      ok: false,
      detail: 'Bad configuration option: Nope',
    });
  });
});

describe('InstallHostAdapter (fs side)', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should_ensure_dirs_files_and_read_remove_them', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-host-'));
    const runner = new RecordingRunner();
    const host = new InstallHostAdapter(runner);
    const sub = join(dir, 'spool');
    const file = join(dir, 'kobox.htpasswd');

    await host.ensureDir(sub, '1733');
    expect(statSync(sub).mode & 0o7777).toBe(0o1733);

    const created = await host.ensureFile({
      path: file,
      content: '',
      mode: '0640',
      owner: 'root',
      group: 'root',
    });
    expect(created).toBe(true);
    writeFileSync(file, 'alice:$hash');
    expect(
      await host.ensureFile({ path: file, content: '', mode: '0640', owner: 'root', group: 'root' }),
    ).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('alice:$hash');

    expect(await host.readFile(file)).toBe('alice:$hash');
    expect(await host.pathExists(file)).toBe(true);
    await host.removeFile(file);
    expect(existsSync(file)).toBe(false);
    // removing an absent file converges silently
    await expect(host.removeFile(file)).resolves.toBeUndefined();
  });

  it('should_extract_tarballs_with_one_stripped_component_and_parse_mount_options', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-host-'));
    mkdirSync(join(dir, 'dest'));
    const runner = new RecordingRunner();
    runner.on((r) =>
      r.command === 'findmnt'
        ? { stdout: 'rw,relatime,usrquota\n', stderr: '', exitCode: 0 }
        : undefined,
    );
    const host = new InstallHostAdapter(runner);

    await host.extractTarGz(join(dir, 'x.tar.gz'), join(dir, 'dest'));
    expect(runner.argvs()[0]).toBe(
      `tar -xzf ${join(dir, 'x.tar.gz')} -C ${join(dir, 'dest')} --strip-components=1`,
    );

    expect(await host.mountOptions('/home')).toEqual(['rw', 'relatime', 'usrquota']);
  });

  it('should_run_sysctl_postconf_debconf_and_quota_argv_only', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-host-'));
    const runner = new RecordingRunner();
    const host = new InstallHostAdapter(runner);

    await host.applySysctl();
    await host.postconf({ inet_interfaces: 'loopback-only' });
    await host.preseedDebconf(['postfix postfix/main_mailer_type select Local only']);
    await host.activateQuota('/home');

    expect(runner.argvs()).toEqual([
      'sysctl --system',
      'postconf -e inet_interfaces=loopback-only',
      'debconf-set-selections',
      'quotacheck -ugm /home',
      'quotaon -ug /home',
    ]);
    expect(runner.calls[2]?.stdin).toContain('main_mailer_type');
  });
});
