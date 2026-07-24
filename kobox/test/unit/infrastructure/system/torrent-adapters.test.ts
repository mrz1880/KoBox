import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import type { RenderedFile } from '../../../../src/domain/torrent/ports.js';
import { WatchDir } from '../../../../src/domain/torrent/WatchDir.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { RtorrentConfigAdapter } from '../../../../src/infrastructure/system/RtorrentConfigAdapter.js';
import { ScgiRtorrentControlAdapter, RtorrentFaultError } from '../../../../src/infrastructure/system/ScgiRtorrentControlAdapter.js';
import { SystemdServiceControlAdapter } from '../../../../src/infrastructure/system/SystemdServiceControlAdapter.js';
import { UserScriptRunnerAdapter } from '../../../../src/infrastructure/system/UserScriptRunnerAdapter.js';
import { WatchDirAdapter } from '../../../../src/infrastructure/system/WatchDirAdapter.js';

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

  lines(): string[] {
    return this.calls.map((c) => [c.command, ...c.args].join(' '));
  }
}

const alice = Username.parse('alice');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kobox-adapters-'));
}

describe('RtorrentConfigAdapter', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function file(path: string, content: string): RenderedFile {
    return { path, content, mode: '0640', owner: 'root', group: 'alice' };
  }

  it('should_write_new_files_and_report_them_changed', async () => {
    const runner = new RecordingRunner();
    const adapter = new RtorrentConfigAdapter(runner);
    const target = join(dir, 'sub', '.rtorrent.rc');

    const changed = await adapter.apply([file(target, 'content-v1\n')]);

    expect(changed).toEqual([target]);
    expect(readFileSync(target, 'utf8')).toBe('content-v1\n');
    expect(runner.lines()).toContain(`chown root:alice ${target}`);
    expect(runner.lines()).toContain(`chmod 0640 ${target}`);
  });

  it('should_be_idempotent_when_content_is_identical', async () => {
    const runner = new RecordingRunner();
    const adapter = new RtorrentConfigAdapter(runner);
    const target = join(dir, '.rtorrent.rc');
    await adapter.apply([file(target, 'same\n')]);
    runner.calls.length = 0;

    const changed = await adapter.apply([file(target, 'same\n')]);

    expect(changed).toEqual([]);
    expect(runner.calls).toEqual([]); // no chown/chmod churn either
  });

  it('should_rewrite_only_files_whose_content_differs', async () => {
    const runner = new RecordingRunner();
    const adapter = new RtorrentConfigAdapter(runner);
    const stable = join(dir, 'stable.rc');
    const drifted = join(dir, 'drifted.rc');
    await adapter.apply([file(stable, 'stable\n'), file(drifted, 'v1\n')]);

    const changed = await adapter.apply([file(stable, 'stable\n'), file(drifted, 'v2\n')]);

    expect(changed).toEqual([drifted]);
    expect(readFileSync(drifted, 'utf8')).toBe('v2\n');
  });

  it('should_never_touch_files_it_was_not_given', async () => {
    const runner = new RecordingRunner();
    const adapter = new RtorrentConfigAdapter(runner);
    const userDropIn = join(dir, '99-user.rc');
    writeFileSync(userDropIn, 'my precious tweaks\n');

    await adapter.apply([file(join(dir, '80-watch.rc'), 'managed\n')]);

    expect(readFileSync(userDropIn, 'utf8')).toBe('my precious tweaks\n');
  });
});

describe('WatchDirAdapter', () => {
  it('should_ensure_the_layout_with_install_argv_only', async () => {
    const runner = new RecordingRunner();
    const adapter = new WatchDirAdapter(runner);

    await adapter.ensureLayout(alice, [WatchDir.root(), WatchDir.labeled(Label.parse('films'))]);

    const lines = runner.lines();
    expect(lines).toContain(
      'install -d -o alice -g kobox-users -m 0755 /home/alice/rtorrent',
    );
    expect(lines).toContain(
      'install -d -o alice -g kobox-users -m 0755 /home/alice/rtorrent/config.d',
    );
    expect(lines).toContain(
      'install -d -o alice -g kobox-users -m 0775 /home/alice/rtorrent/watch/films',
    );
    expect(lines).toContain(
      'install -d -o alice -g kobox-users -m 0755 /home/alice/rtorrent/complete/films',
    );
    expect(lines).toContain(
      'install -d -o alice -g kobox-users -m 0755 /home/alice/rtorrent/torrents/films',
    );
  });
});

describe('SystemdServiceControlAdapter unit provisioning', () => {
  let etc: string;
  beforeEach(() => {
    etc = tempDir();
  });
  afterEach(() => {
    rmSync(etc, { recursive: true, force: true });
  });

  it('should_install_the_unit_then_daemon_reload_and_enable', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemdServiceControlAdapter(runner, etc);

    await adapter.installUserService(alice, '[Unit]\nv1\n');

    expect(readFileSync(join(etc, 'rtorrent-alice.service'), 'utf8')).toBe('[Unit]\nv1\n');
    expect(runner.lines()).toEqual([
      'systemctl daemon-reload',
      'systemctl enable rtorrent-alice',
    ]);
  });

  it('should_skip_daemon_reload_when_the_unit_is_unchanged', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemdServiceControlAdapter(runner, etc);
    await adapter.installUserService(alice, '[Unit]\nv1\n');
    runner.calls.length = 0;

    await adapter.installUserService(alice, '[Unit]\nv1\n');

    expect(runner.calls).toEqual([]);
  });

  it('should_remove_the_unit_disabling_it_first_and_tolerate_absence', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemdServiceControlAdapter(runner, etc);
    await adapter.installUserService(alice, '[Unit]\nv1\n');
    runner.calls.length = 0;

    await adapter.removeUserService(alice);
    expect(existsSync(join(etc, 'rtorrent-alice.service'))).toBe(false);
    expect(runner.lines()).toEqual([
      'systemctl disable --now rtorrent-alice',
      'systemctl daemon-reload',
    ]);

    await adapter.removeUserService(alice); // already gone: still converges
  });

  it('should_restart_via_systemctl', async () => {
    const runner = new RecordingRunner();
    const adapter = new SystemdServiceControlAdapter(runner, etc);

    await adapter.restartUserService(alice);

    expect(runner.lines()).toEqual(['systemctl restart rtorrent-alice']);
  });
});

describe('UserScriptRunnerAdapter', () => {
  let home: string;
  beforeEach(() => {
    home = tempDir();
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const args = {
    basePath: '/home/alice/rtorrent/complete/x',
    directory: '/home/alice/rtorrent/complete',
    label: 'films',
    name: 'x',
  };

  it('should_run_each_user_script_as_the_user_via_runuser', async () => {
    const scripts = join(home, 'scripts');
    mkdirSync(scripts);
    writeFileSync(join(scripts, 'synchro.sh'), '#!/bin/sh\n');
    writeFileSync(join(scripts, 'notes.txt'), 'not a script');
    const runner = new RecordingRunner();
    const adapter = new UserScriptRunnerAdapter(runner, () => home);

    await adapter.runFinishedScripts(alice, args);

    expect(runner.lines()).toEqual([
      `runuser -u alice -- ${join(scripts, 'synchro.sh')} ${args.basePath} ${args.directory} ${args.label} ${args.name}`,
    ]);
  });

  it('should_be_a_silent_noop_without_a_scripts_directory', async () => {
    const runner = new RecordingRunner();
    const adapter = new UserScriptRunnerAdapter(runner, () => home);

    await adapter.runFinishedScripts(alice, args);

    expect(runner.calls).toEqual([]);
  });

  it('should_swallow_script_failures_instead_of_failing_the_event', async () => {
    const scripts = join(home, 'scripts');
    mkdirSync(scripts);
    writeFileSync(join(scripts, 'broken.sh'), '#!/bin/sh\nexit 1\n');
    const runner = new RecordingRunner();
    runner.onCommand('runuser', { exitCode: 1, stderr: 'boom' });
    const adapter = new UserScriptRunnerAdapter(runner, () => home);

    await expect(adapter.runFinishedScripts(alice, args)).resolves.toBeUndefined();
  });
});

describe('ScgiRtorrentControlAdapter', () => {
  let server: Server;
  let port: number;
  const received: string[] = [];
  let reply = '';

  beforeEach(async () => {
    received.length = 0;
    reply =
      'Status: 200 OK\r\nContent-Type: text/xml\r\n\r\n' +
      '<?xml version="1.0"?><methodResponse><params><param><value><i8>0</i8></value></param></params></methodResponse>';
    server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk) => {
        chunks.push(chunk);
        const data = Buffer.concat(chunks).toString('utf8');
        if (data.includes('</methodCall>')) {
          received.push(data);
          socket.end(reply);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('should_send_d_stop_then_d_close_as_scgi_xmlrpc', async () => {
    const adapter = new ScgiRtorrentControlAdapter();
    const hash = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');

    await adapter.stopAndClose(ScgiPort.parse(port), hash);

    expect(received).toHaveLength(2);
    expect(received[0]).toContain('<methodName>d.stop</methodName>');
    expect(received[0]).toContain(hash.value);
    expect(received[0]).toContain('CONTENT_LENGTH');
    expect(received[0]).toContain('SCGI\u00001\u0000');
    expect(received[1]).toContain('<methodName>d.close</methodName>');
  });

  it('should_throw_on_an_xmlrpc_fault', async () => {
    reply =
      'Status: 200 OK\r\nContent-Type: text/xml\r\n\r\n' +
      '<?xml version="1.0"?><methodResponse><fault><value><struct/></value></fault></methodResponse>';
    const adapter = new ScgiRtorrentControlAdapter();
    const hash = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');

    await expect(adapter.stopAndClose(ScgiPort.parse(port), hash)).rejects.toThrow(
      RtorrentFaultError,
    );
  });
});
