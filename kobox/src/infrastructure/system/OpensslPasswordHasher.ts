import { timingSafeEqual } from 'node:crypto';
import { HashedPassword } from '../../domain/user/HashedPassword.js';
import type { Password } from '../../domain/user/Password.js';
import type { PasswordHasherPort } from '../../domain/user/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// $6$<salt>$<digest> — the only shape hash() ever produces; verify() refuses
// anything else instead of guessing.
const SHA512_CRYPT_PATTERN = /^\$6\$([A-Za-z0-9./]{1,16})\$[A-Za-z0-9./]+$/;

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

  async verify(password: Password, hash: HashedPassword): Promise<boolean> {
    const match = SHA512_CRYPT_PATTERN.exec(hash.value);
    if (match === null) {
      return false;
    }
    const salt = match[1] ?? '';
    const result = await runOrThrow(this.runner, {
      command: 'openssl',
      args: ['passwd', '-6', '-salt', salt, '-stdin'],
      stdin: `${password.reveal()}\n`,
    });
    const recomputed = Buffer.from(result.stdout.trim());
    const stored = Buffer.from(hash.value);
    return recomputed.length === stored.length && timingSafeEqual(recomputed, stored);
  }
}
