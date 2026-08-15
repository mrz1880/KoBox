import { describe, expect, it } from 'vitest';
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

    await new SshRemoteProbe(runner, '/var/lib/kobox/sync').probe(destination, password);

    expect(runner.calls[0]?.command).toBe('mkdir');
    expect(runner.calls[0]?.args).toEqual(['-p', '-m', '0700', '/var/lib/kobox/sync']);
  });

  it('should_pass_the_password_through_the_environment_and_never_through_argv', async () => {
    const runner = new ScriptedRunner();

    await new SshRemoteProbe(runner, '/var/lib/kobox/sync').probe(destination, password);

    const ssh = runner.calls.find((call) => call.command === 'sshpass');
    // `sshpass -p <password>` would put it in `ps` for every other member
    expect(ssh?.args).toContain('-e');
    expect(ssh?.args.join(' ')).not.toContain('hunter2000');
    expect(ssh?.env).toEqual({ SSHPASS: 'hunter2000' });
  });

  it('should_pin_the_host_key_on_first_sight_and_refuse_a_change_afterwards', async () => {
    const runner = new ScriptedRunner();

    await new SshRemoteProbe(runner, '/var/lib/kobox/sync').probe(destination, password);

    const argv = runner.calls.find((call) => call.command === 'sshpass')?.args.join(' ') ?? '';
    expect(argv).toContain('StrictHostKeyChecking=accept-new');
    expect(argv).toContain('UserKnownHostsFile=/var/lib/kobox/sync/alice.known_hosts');
    // the legacy passed both of these, which trusts whatever answers
    expect(argv).not.toContain('StrictHostKeyChecking=no');
    expect(argv).not.toContain('/dev/null');
  });

  it('should_say_the_folder_is_the_problem_when_the_account_itself_works', async () => {
    const runner = new ScriptedRunner();
    // `test -w` failing looks like exit 1 with nothing on stderr
    runner.onCommand('sshpass', { exitCode: 1, stderr: '' });

    const outcome = await new SshRemoteProbe(runner, '/tmp/kh').probe(destination, password);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('folder');
  });

  it('should_translate_a_refused_password_into_something_a_member_can_act_on', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('sshpass', { exitCode: 5, stderr: 'Permission denied, please try again.' });

    const outcome = await new SshRemoteProbe(runner, '/tmp/kh').probe(destination, password);

    expect(outcome.detail).toContain('refused the account or the password');
  });

  it('should_name_a_changed_host_key_for_what_it_is', async () => {
    const runner = new ScriptedRunner();
    runner.onCommand('sshpass', {
      exitCode: 255,
      stderr: 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!',
    });

    const outcome = await new SshRemoteProbe(runner, '/tmp/kh').probe(destination, password);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('different identity');
  });
});
