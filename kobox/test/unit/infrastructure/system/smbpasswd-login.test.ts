import { describe, expect, it } from 'vitest';
import { Password } from '../../../../src/domain/user/Password.js';
import { Username } from '../../../../src/domain/user/Username.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { SmbpasswdLogin } from '../../../../src/infrastructure/system/SmbpasswdLogin.js';

// pdbedit -L lists one "name:uid:full name" line per Samba account
class SambaRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  constructor(private readonly accounts: readonly string[] = []) {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const stdout =
      request.command === 'pdbedit'
        ? this.accounts.map((name, index) => `${name}:${String(1001 + index)}:`).join('\n')
        : '';
    return Promise.resolve({ stdout, stderr: '', exitCode: 0 });
  }
}

const alice = Username.parse('alice');
const password = Password.parse('correct horse battery');

describe('SmbpasswdLogin', () => {
  it('should_set_the_share_password_through_stdin_never_argv', async () => {
    const runner = new SambaRunner();

    await new SmbpasswdLogin(runner).setPassword(alice, password);

    expect(runner.calls).toEqual([
      {
        command: 'smbpasswd',
        args: ['-s', '-a', 'alice'],
        stdin: `${password.reveal()}\n${password.reveal()}\n`,
      },
    ]);
  });

  it('should_delete_the_share_account_of_a_member', async () => {
    const runner = new SambaRunner(['bob', 'alice']);

    await new SmbpasswdLogin(runner).remove(alice);

    expect(runner.calls.at(-1)).toEqual({ command: 'smbpasswd', args: ['-x', 'alice'] });
  });

  it('should_take_a_share_account_that_is_already_gone_as_deleted', async () => {
    const runner = new SambaRunner(['alicia']);

    await new SmbpasswdLogin(runner).remove(alice);

    expect(runner.calls.map((call) => call.command)).toEqual(['pdbedit']);
  });
});
