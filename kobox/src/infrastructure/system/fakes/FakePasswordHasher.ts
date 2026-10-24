import { HashedPassword } from '../../../domain/user/HashedPassword.js';
import type { Password } from '../../../domain/user/Password.js';
import type { PasswordHasherPort } from '../../../domain/user/ports.js';

// Deterministic stand-in for openssl passwd: a valid crypt(3)-shaped hash that
// only the same password verifies against. Hex keeps any password inside the
// crypt alphabet.
export class FakePasswordHasher implements PasswordHasherPort {
  hash(password: Password): Promise<HashedPassword> {
    return Promise.resolve(HashedPassword.parse(this.digest(password)));
  }

  verify(password: Password, hash: HashedPassword): Promise<boolean> {
    return Promise.resolve(hash.value === this.digest(password));
  }

  private digest(password: Password): string {
    return `$6$fakesalt$${Buffer.from(password.reveal(), 'utf8').toString('hex')}`;
  }
}
