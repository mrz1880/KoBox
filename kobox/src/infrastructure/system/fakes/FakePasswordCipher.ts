import { Password } from '../../../domain/user/Password.js';
import type { PasswordOpenerPort, PasswordSealerPort } from '../../../domain/user/ports.js';

// As long as a real RSA-4096 block, so it passes the job contract, but nothing
// more than hex behind a fixed prefix: a test can open what it sealed.
const PREFIX = 'A'.repeat(684);

export class FakePasswordCipher implements PasswordSealerPort, PasswordOpenerPort {
  seal(password: Password): Promise<string> {
    return Promise.resolve(PREFIX + Buffer.from(password.reveal(), 'utf8').toString('hex'));
  }

  open(sealed: string): Promise<Password> {
    if (!sealed.startsWith(PREFIX)) {
      return Promise.reject(new Error('rsa sealing: stored password could not be opened'));
    }
    return Promise.resolve(
      Password.parse(Buffer.from(sealed.slice(PREFIX.length), 'hex').toString('utf8')),
    );
  }
}
