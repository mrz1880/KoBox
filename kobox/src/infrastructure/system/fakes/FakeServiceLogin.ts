import type { Password } from '../../../domain/user/Password.js';
import type { ServiceLoginPort } from '../../../domain/user/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeServiceLogin implements ServiceLoginPort {
  private readonly passwords = new Map<string, string>();
  private nextFailure: string | undefined;

  failNextSetPassword(message: string): void {
    this.nextFailure = message;
  }

  setPassword(username: Username, password: Password): Promise<void> {
    if (this.nextFailure !== undefined) {
      const message = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.reject(new Error(message));
    }
    this.passwords.set(username.value, password.reveal());
    return Promise.resolve();
  }

  remove(username: Username): Promise<void> {
    this.passwords.delete(username.value);
    return Promise.resolve();
  }

  passwordOf(username: Username): string | undefined {
    return this.passwords.get(username.value);
  }
}
