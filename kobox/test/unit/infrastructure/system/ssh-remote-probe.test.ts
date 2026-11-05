import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostKeyFingerprint } from '../../../../src/domain/sync/HostKeyFingerprint.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePassword } from '../../../../src/domain/sync/RemotePassword.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import { SendHour } from '../../../../src/domain/sync/SendHour.js';
import { SshRemoteProbe } from '../../../../src/infrastructure/system/SshRemoteProbe.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { Username } from '../../../../src/domain/user/Username.js';

class ScriptedRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  // what each rsync call found in its local source folder, read while it ran:
  // the probe removes its scratch folders once done
  readonly sentTrees: (readonly string[] | undefined)[] = [];
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
    if (request.command === 'rsync') {
      const local = request.args.at(-2);
      this.sentTrees.push(
        local !== undefined && local.startsWith('/') && existsSync(local)
          ? readdirSync(local)
          : undefined,
      );
    }
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

const PROBE_FOLDER = '.kobox-write-check-test';

function aProbe(runner: CommandRunner): SshRemoteProbe {
  return new SshRemoteProbe(
    runner,
    '/var/lib/kobox/sync',
    mkdtempSync(join(tmpdir(), 'kobox-test-')),
    () => PROBE_FOLDER,
  );
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

describe('SshRemoteProbe', () => {
  it('should_create_the_known_hosts_directory_before_it_connects', async () => {
    // without it ssh cannot pin the key it just saw, and the whole
    // trust-on-first-use argument quietly stops holding
    const runner = new ScriptedRunner();

    await new SshRemoteProbe(runner, '/var/lib/kobox/sync').probe(destination, password, 'keep-recorded');

    expect(runner.calls[0]?.command).toBe('mkdir');
    expect(runner.calls[0]?.args).toEqual(['-p', '-m', '0700', '/var/lib/kobox/sync']);
  });

  it('should_pass_the_password_through_the_environment_and_never_through_argv', async () => {
    const runner = new ScriptedRunner();

    await new SshRemoteProbe(runner, '/var/lib/kobox/sync').probe(destination, password, 'keep-recorded');

    const rsync = runner.calls.find((call) => call.command === 'rsync');
    // `sshpass -p <password>` would put it in `ps` for every other member
    expect(rsync?.args.join(' ')).toContain('sshpass -e ssh');
    expect(rsync?.args.join(' ')).not.toContain('hunter2000');
    expect(rsync?.env).toEqual({ SSHPASS: 'hunter2000' });
  });

  it('should_ask_only_what_an_account_allowed_sftp_and_rsync_may_answer', async () => {
    // a Synology gives a shell to administrators alone: `test -w` over ssh
    // read as a refused password for an ordinary account that rsync lets in
    const runner = new ScriptedRunner();

    await new SshRemoteProbe(runner, '/var/lib/kobox/sync').probe(destination, password, 'keep-recorded');

    const remote = runner.calls.filter((call) => ['sshpass', 'ssh', 'rsync'].includes(call.command));
    expect(new Set(remote.map((call) => call.command))).toEqual(new Set(['rsync']));
    expect(remote[0]?.args).toContain('--list-only');
    expect(remote[0]?.args.at(-1)).toBe('seedbox@nas.example.org:/volume1/torrents/');
  });

  it('should_pin_the_host_key_on_first_sight_and_refuse_a_change_afterwards', async () => {
    const runner = new ScriptedRunner();

    await new SshRemoteProbe(runner, '/var/lib/kobox/sync').probe(destination, password, 'keep-recorded');

    const argv = runner.calls.find((call) => call.command === 'rsync')?.args.join(' ') ?? '';
    expect(argv).toContain('StrictHostKeyChecking=accept-new');
    expect(argv).toContain('UserKnownHostsFile=/var/lib/kobox/sync/alice.known_hosts');
    // the legacy passed both of these, which trusts whatever answers
    expect(argv).not.toContain('StrictHostKeyChecking=no');
    expect(argv).not.toContain('/dev/null');
  });

  it('should_say_the_folder_is_the_problem_when_the_account_itself_works', async () => {
    const runner = new ScriptedRunner();
    // in, but the folder is not there: rsync's partial-transfer code
    runner.onCommand('rsync', {
      exitCode: 23,
      stderr: 'rsync: [sender] change_dir "/volume1/torrents" failed: No such file or directory (2)',
    });

    const outcome = await new SshRemoteProbe(runner, '/tmp/kh').probe(destination, password, 'keep-recorded');

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('folder');
  });

  it('should_translate_a_refused_password_into_something_a_member_can_act_on', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', { exitCode: 255, stderr: 'Permission denied, please try again.' });

    const outcome = await new SshRemoteProbe(runner, '/tmp/kh').probe(destination, password, 'keep-recorded');

    expect(outcome.detail).toContain('refused the account or the password');
  });

  it('should_name_a_changed_host_key_for_what_it_is', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', {
      exitCode: 255,
      stderr: 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!',
    });

    const outcome = await new SshRemoteProbe(runner, '/tmp/kh').probe(destination, password, 'keep-recorded');

    expect(outcome.ok).toBe(false);
    // a check that may not accept a new identity says how to accept one
    expect(outcome.detail).toBe(
      'the machine presented another identity than the one recorded for it: if you reinstalled it, test the connection again to accept its new identity, otherwise stop and check why',
    );
  });

  // seen on 2026-11-04: an account that could list the folder but not write in
  // it passed the check, and every transfer failed right after
  it('should_prove_the_account_can_write_by_making_a_probe_folder_there', async () => {
    const runner = new ScriptedRunner();

    await aProbe(runner).probe(destination, password, 'keep-recorded');

    const write = runner.rsyncs()[1];
    expect(write?.args.at(-1)).toBe('seedbox@nas.example.org:/volume1/torrents/');
    expect(runner.sentTrees[1]).toEqual([PROBE_FOLDER]);
  });

  it('should_say_the_account_signs_in_but_cannot_write_when_the_write_is_refused', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand(
      'rsync',
      { exitCode: 0 },
      {
        exitCode: 23,
        stderr: `rsync: [generator] recv_generator: mkdir "/volume1/torrents/${PROBE_FOLDER}" failed: Permission denied (13)`,
      },
    );

    const outcome = await aProbe(runner).probe(destination, password, 'keep-recorded');

    expect(outcome).toMatchObject({
      ok: false,
      detail: 'the account can sign in but cannot write in that folder',
    });
  });

  it('should_say_the_account_can_write_there_once_it_has', async () => {
    const outcome = await aProbe(new ScriptedRunner()).probe(destination, password, 'keep-recorded');

    expect(outcome).toMatchObject({
      ok: true,
      detail: 'the machine answered, and the account can write in that folder',
    });
  });

  it('should_remove_the_probe_folder_and_nothing_else', async () => {
    const runner = new ScriptedRunner();

    await aProbe(runner).probe(destination, password, 'keep-recorded');

    const removal = runner.rsyncs()[2];
    // an empty folder sent with --delete would empty the member's whole folder:
    // the filters let only the probe folder go, and --max-delete caps the harm
    // at one entry should they ever be wrong
    expect(removal?.args).toEqual(
      expect.arrayContaining([
        '--delete',
        `--include=/${PROBE_FOLDER}/`,
        '--exclude=*',
        '--max-delete=1',
      ]),
    );
    expect(removal?.args.indexOf(`--include=/${PROBE_FOLDER}/`)).toBeLessThan(
      removal?.args.indexOf('--exclude=*') ?? -1,
    );
    expect(removal?.args).not.toContain('--delete-excluded');
    expect(runner.sentTrees[2]).toEqual([]);
    expect(removal?.args.at(-1)).toBe('seedbox@nas.example.org:/volume1/torrents/');
  });

  // after a reinstall the machine has a new identity: a check the member runs
  // replaces the recorded one, and nothing else ever does
  const IDENTITY_CHANGED = {
    exitCode: 255,
    stderr: '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.',
  };

  it('should_replace_the_recorded_identity_when_the_member_accepts_the_one_presented', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', IDENTITY_CHANGED, { exitCode: 0 });

    const outcome = await aProbe(runner).probe(destination, password, 'accept-presented');

    const forget = runner.calls.findIndex((call) => call.args.includes('-R'));
    expect(runner.calls[forget]).toMatchObject({
      command: 'ssh-keygen',
      args: ['-R', '[nas.example.org]:2222', '-f', '/var/lib/kobox/sync/alice.known_hosts'],
    });
    // then the machine is asked again, as a first contact
    expect(runner.calls.slice(forget + 1).some((call) => call.args.includes('--list-only'))).toBe(true);
    expect(outcome.ok).toBe(true);
  });

  // a test run while the machine is off must not drop what is recorded: the
  // next transfer would then take whatever answers as a first contact
  it('should_keep_the_recorded_identity_while_the_machine_presents_no_other', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', { exitCode: 255, stderr: 'ssh: connect to host nas.example.org port 2222: Connection refused' });

    await aProbe(runner).probe(destination, password, 'accept-presented');

    expect(runner.calls.some((call) => call.args.includes('-R'))).toBe(false);
  });

  it('should_never_replace_the_recorded_identity_in_a_check_that_follows_a_save', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', IDENTITY_CHANGED);

    const outcome = await aProbe(runner).probe(destination, password, 'keep-recorded');

    expect(runner.calls.some((call) => call.args.includes('-R'))).toBe(false);
    expect(outcome.ok).toBe(false);
  });

  // the identity shown to the member is the one ssh recorded and checks, read
  // back from the member's known_hosts, not a second scan that may pick
  // another of the machine's keys
  it('should_report_the_identity_recorded_for_the_machine_after_the_contact', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('ssh-keygen', {
      stdout: '# Host [nas.example.org]:2222 found: line 1 \n[nas.example.org]:2222 ED25519 SHA256:abc\n',
    });

    const outcome = await aProbe(runner).probe(destination, password, 'keep-recorded');

    expect(outcome.identity).toEqual(HostKeyFingerprint.parse('SHA256:abc'));
    expect(runner.calls.find((call) => call.command === 'ssh-keygen')?.args).toEqual([
      '-l',
      '-F',
      '[nas.example.org]:2222',
      '-f',
      '/var/lib/kobox/sync/alice.known_hosts',
    ]);
    expect(runner.calls.some((call) => call.command === 'ssh-keyscan')).toBe(false);
  });

  // ssh files a machine on the default port under its bare name
  it('should_forget_a_machine_on_the_default_port_under_its_bare_name', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('rsync', IDENTITY_CHANGED, { exitCode: 0 });
    const onDefaultPort = destination.withConnection({ ...connectionOf(destination), port: RemotePort.parse(22) });

    await aProbe(runner).probe(onDefaultPort, password, 'accept-presented');

    expect(runner.calls.find((call) => call.args.includes('-R'))?.args[1]).toBe('nas.example.org');
  });
});

function connectionOf(of: SyncDestination): Parameters<SyncDestination['withConnection']>[0] {
  return { host: of.host, port: of.port, account: of.account, path: of.path };
}
