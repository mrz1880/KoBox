import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePassword } from '../../../../src/domain/sync/RemotePassword.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { SendHour } from '../../../../src/domain/sync/SendHour.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import { RsyncOverSshTransfer } from '../../../../src/infrastructure/system/RsyncOverSshTransfer.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { Username } from '../../../../src/domain/user/Username.js';

class ScriptedRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  private readonly results = new Map<string, CommandResult[]>();

  // answers given in turn to successive calls of that command, the last one
  // repeating
  onCommand(command: string, ...results: Partial<CommandResult>[]): void {
    this.results.set(
      command,
      results.map((result) => ({ stdout: '', stderr: '', exitCode: 0, ...result })),
    );
  }

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const queue = this.results.get(request.command) ?? [];
    const result = (queue.length > 1 ? queue.shift() : queue[0]) ?? {
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
    return Promise.resolve(result);
  }

  rsyncs(): CommandRequest[] {
    return this.calls.filter((call) => call.command === 'rsync');
  }
}

const destination = SyncDestination.define({
  username: Username.parse('alice'),
  host: RemoteHost.parse('nas.example.org'),
  port: RemotePort.parse(2222),
  account: RemoteAccount.parse('seedbox'),
  sealedPassword: 'sealed',
  path: RemotePath.parse('/volume1/torrents'),
  batchSize: TransferBatchSize.unlimited(),
  placement: LoneFilePlacement.besideTheOthers,
  sendHour: SendHour.default(),
});
const password = RemotePassword.parse('hunter2000');
const source = LocalPath.parse('/home/alice/rtorrent/complete/Films/Some.Film.2024.mkv');

function transfer(
  runner: CommandRunner,
  remoteFolder = '/volume1/torrents/Films',
): Promise<{ ok: boolean; detail?: string }> {
  return new RsyncOverSshTransfer(runner, '/var/lib/kobox/sync').send({
    destination,
    password,
    source,
    remoteFolder,
  });
}

describe('RsyncOverSshTransfer', () => {
  it('should_send_the_file_exactly_once', async () => {
    // The legacy looped `for ((i = 3; i >= 1; i -= 1))` with its `break`
    // commented out, so every file went across three times, every pass. Retry
    // is a decision about failure, not a loop body.
    const runner = new ScriptedRunner();

    await transfer(runner);

    expect(runner.rsyncs().filter((call) => call.args.includes(source.value))).toHaveLength(1);
  });

  it('should_make_the_remote_folders_with_rsync_alone_before_it_copies', async () => {
    // a Synology gives a shell to administrators alone: `mkdir -p` over ssh
    // refused an ordinary account allowed rsync and SFTP
    const runner = new ScriptedRunner();

    await transfer(runner, '/volume1/torrents/Films/Some.Film.2024');

    expect(runner.calls.some((call) => ['sshpass', 'ssh'].includes(call.command))).toBe(false);
    const [folders, file] = runner.rsyncs();
    expect(folders?.args.at(-1)).toBe('seedbox@nas.example.org:/volume1/torrents/');
    expect(folders?.args).toContain('--recursive');
    // --archive would hand the empty tree's 0700 to the member's own root folder
    const ownFlags = (folders?.args ?? []).filter(
      (arg, i, all) => arg.startsWith('-') && all[i - 1] !== '-e',
    );
    expect(ownFlags.join(' ')).not.toMatch(/--archive|--perms|(^| )-[a-zA-Z]*[ap]/);
    expect(file?.args.at(-1)).toBe('seedbox@nas.example.org:/volume1/torrents/Films/Some.Film.2024/');
  });

  it('should_leave_no_scratch_tree_behind_even_when_the_folders_fail', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kobox-test-'));
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', { exitCode: 3, stderr: 'mkdir failed' });

    await new RsyncOverSshTransfer(runner, '/var/lib/kobox/sync', scratch).send({
      destination,
      password,
      source,
      remoteFolder: '/volume1/torrents/Films',
    });

    expect(readdirSync(scratch)).toEqual([]);
  });

  it('should_pass_the_password_through_the_environment_and_never_through_argv', async () => {
    const runner = new ScriptedRunner();

    await transfer(runner);

    for (const call of runner.rsyncs()) {
      expect(call.args.join(' ')).not.toContain('hunter2000');
      expect(call.args.join(' ')).toContain('sshpass -e ssh');
      expect(call.env?.SSHPASS).toBe('hunter2000');
    }
  });

  it('should_keep_pinning_the_host_key_it_pinned_when_the_member_tested_it', async () => {
    const runner = new ScriptedRunner();

    await transfer(runner);

    const argv = runner.calls.map((call) => call.args.join(' ')).join(' | ');
    expect(argv).toContain('UserKnownHostsFile=/var/lib/kobox/sync/alice.known_hosts');
    expect(argv).not.toContain('StrictHostKeyChecking=no');
    expect(argv).not.toContain('/dev/null');
  });

  it('should_report_what_rsync_said_when_it_could_not_finish', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand(
      'rsync',
      {},
      { exitCode: 12, stderr: 'rsync: connection unexpectedly closed' },
    );

    const outcome = await transfer(runner);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('connection');
  });

  it('should_not_copy_at_all_when_the_remote_folder_could_not_be_made', async () => {
    // copying into a folder that does not exist scatters files at the root of
    // the member's NAS, which is worse than not copying
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', { exitCode: 3, stderr: 'rsync: mkdir "/volume1/torrents/Films" failed: Permission denied' });

    const outcome = await transfer(runner);

    expect(outcome.ok).toBe(false);
    expect(runner.rsyncs()).toHaveLength(1);
  });
});
