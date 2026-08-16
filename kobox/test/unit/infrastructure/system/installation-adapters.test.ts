import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AptPackageAdapter } from '../../../../src/infrastructure/system/AptPackageAdapter.js';
import {
  ArtifactFetchAdapter,
  ArtifactFetchError,
} from '../../../../src/infrastructure/system/ArtifactFetchAdapter.js';
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

  callsOf(command: string): readonly CommandRequest[] {
    return this.calls.filter((c) => c.command === command);
  }
}

const ok = (stdout: string): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (code: number, stderr = ''): CommandResult => ({ stdout: '', stderr, exitCode: code });

function installedPackages(...names: readonly string[]): (r: CommandRequest) => CommandResult | undefined {
  return (request) => {
    if (request.command !== 'dpkg-query') {
      return undefined;
    }
    const pkg = request.args.at(-1) ?? '';
    return names.includes(pkg) ? ok('installed') : fail(1, `no packages found matching ${pkg}`);
  };
}

describe('AptPackageAdapter', () => {
  it('should_install_only_the_missing_packages_noninteractively', async () => {
    const runner = new RecordingRunner();
    runner.on(installedPackages('rtorrent'));
    const apt = new AptPackageAdapter(runner);

    await apt.ensureInstalled(['rtorrent', 'nginx', 'php-fpm']);

    const installs = runner.callsOf('apt-get');
    expect(installs).toHaveLength(1);
    expect(installs[0]?.args).toEqual([
      'install',
      '-y',
      '--no-install-recommends',
      'nginx',
      'php-fpm',
    ]);
    expect(installs[0]?.env).toEqual({ DEBIAN_FRONTEND: 'noninteractive' });
  });

  it('should_issue_no_apt_command_when_everything_is_installed_already', async () => {
    const runner = new RecordingRunner();
    runner.on(installedPackages('rtorrent', 'nginx'));
    const apt = new AptPackageAdapter(runner);

    await apt.ensureInstalled(['rtorrent', 'nginx']);

    expect(runner.callsOf('apt-get')).toHaveLength(0);
  });

  it('should_refresh_the_package_index', async () => {
    const runner = new RecordingRunner();
    const apt = new AptPackageAdapter(runner);

    await apt.refresh();

    expect(runner.callsOf('apt-get')[0]?.args).toEqual(['update']);
  });

  it('should_answer_availability_from_apt_cache_policy', async () => {
    const runner = new RecordingRunner();
    runner.on((request) => {
      if (request.command !== 'apt-cache') {
        return undefined;
      }
      const pkg = request.args.at(-1);
      if (pkg === 'rtorrent') {
        return ok('rtorrent:\n  Installed: (none)\n  Candidate: 0.9.8-2\n');
      }
      if (pkg === 'pgld') {
        return ok('pgld:\n  Installed: (none)\n  Candidate: (none)\n');
      }
      return fail(100, `N: Unable to locate package ${pkg ?? ''}`);
    });
    const apt = new AptPackageAdapter(runner);

    expect(await apt.isAvailable('rtorrent')).toBe(true);
    expect(await apt.isAvailable('pgld')).toBe(false);
    expect(await apt.isAvailable('no-such-package')).toBe(false);
  });

  it('should_report_installed_state_from_dpkg_query', async () => {
    const runner = new RecordingRunner();
    runner.on(installedPackages('nginx'));
    const apt = new AptPackageAdapter(runner);

    expect(await apt.isInstalled('nginx')).toBe(true);
    expect(await apt.isInstalled('bind9')).toBe(false);
  });

  it('should_expose_the_installed_version_for_the_registry', async () => {
    const runner = new RecordingRunner();
    runner.on((request) =>
      request.command === 'dpkg-query' && request.args.includes('${Version}')
        ? ok('1.22.1-9')
        : undefined,
    );
    const apt = new AptPackageAdapter(runner);

    expect(await apt.installedVersion('nginx')).toBe('1.22.1-9');
  });
});

describe('ArtifactFetchAdapter', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function destPath(): string {
    dir = mkdtempSync(join(tmpdir(), 'kobox-artifact-'));
    return join(dir, 'rutorrent.tar.gz');
  }

  const body = Buffer.from('fixture-tarball-bytes');
  const goodSha = createHash('sha256').update(body).digest('hex');

  it('should_write_the_artifact_only_after_the_digest_matches', async () => {
    const adapter = new ArtifactFetchAdapter(() => Promise.resolve(body));
    const dest = destPath();

    await adapter.fetchVerified('https://releases.example.net/rutorrent.tar.gz', goodSha, dest);

    expect(readFileSync(dest)).toEqual(body);
  });

  it('should_replace_a_binary_that_is_currently_running', async () => {
    // Upgrading a pinned release means writing over a file the kernel is
    // executing, and Linux refuses to open a running executable for writing:
    // ETXTBSY. Seen for real when re-pinning NanoMon while its unit was up, and
    // only reachable at all since the installer stopped skipping converged
    // components. Writing beside it and renaming into place is what makes the
    // upgrade work: the running process keeps the old inode, the name gets the
    // new one.
    //
    // Not under os.tmpdir(): in the E2E container /tmp is a noexec tmpfs, the
    // child would never start, and the test would pass having proved nothing.
    const execDir = mkdtempSync(
      join(process.platform === 'linux' ? '/var/tmp' : tmpdir(), 'kobox-exec-'),
    );
    const dest = join(execDir, 'nanomon');
    // a real ELF: for a script the kernel maps the interpreter, so the file
    // itself is never busy
    copyFileSync('/bin/sleep', dest);
    chmodSync(dest, 0o755);
    const child = spawn(dest, ['30'], { stdio: 'ignore' });
    await new Promise((resolve) => {
      child.once('spawn', resolve);
      child.once('error', resolve);
    });

    try {
      // the precondition itself is asserted: a test that cannot hold the file
      // open must fail, not report success
      expect(child.pid, 'the fixture binary did not start').toBeGreaterThan(0);
      expect(child.exitCode).toBeNull();

      const adapter = new ArtifactFetchAdapter(() => Promise.resolve(body));
      await adapter.fetchVerified('https://releases.example.net/nanomon', goodSha, dest);

      expect(readFileSync(dest)).toEqual(body);
    } finally {
      child.kill();
      rmSync(execDir, { recursive: true, force: true });
    }
  });

  it('should_throw_and_leave_nothing_behind_on_a_digest_mismatch', async () => {
    const adapter = new ArtifactFetchAdapter(() => Promise.resolve(body));
    const dest = destPath();

    await expect(
      adapter.fetchVerified('https://releases.example.net/x.tar.gz', 'a'.repeat(64), dest),
    ).rejects.toThrow(ArtifactFetchError);
    expect(existsSync(dest)).toBe(false);
  });

  it('should_throw_when_the_download_fails', async () => {
    const adapter = new ArtifactFetchAdapter(() => Promise.resolve(undefined));
    await expect(
      adapter.fetchVerified('https://releases.example.net/x.tar.gz', goodSha, destPath()),
    ).rejects.toThrow(ArtifactFetchError);
  });

  it('should_refuse_non_https_urls', async () => {
    const adapter = new ArtifactFetchAdapter(() => Promise.resolve(body));
    await expect(
      adapter.fetchVerified('http://releases.example.net/x.tar.gz', goodSha, destPath()),
    ).rejects.toThrow(ArtifactFetchError);
  });
});
