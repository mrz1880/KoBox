import { HashedPassword } from '../../domain/user/HashedPassword.js';
import type { Password } from '../../domain/user/Password.js';
import type { PasswordHasherPort } from '../../domain/user/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

export class OpensslPasswordHasher implements PasswordHasherPort {
  constructor(private readonly runner: CommandRunner) {}

  async hash(password: Password): Promise<HashedPassword> {
    // -stdin keeps the plaintext out of argv; -6 = sha512-crypt
    const result = await runOrThrow(this.runner, {
      command: 'openssl',
      args: ['passwd', '-6', '-stdin'],
      stdin: `${password.reveal()}\n`,
    });
    return HashedPassword.parse(result.stdout.trim());
  }
}
