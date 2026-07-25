import type { LoginAttempt, LoginAttemptsPort } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryLoginAttemptsRepository implements LoginAttemptsPort {
  private readonly rows = new Map<string, LoginAttempt>();

  get(username: Username): Promise<LoginAttempt | undefined> {
    return Promise.resolve(this.rows.get(username.value));
  }

  save(attempt: LoginAttempt): Promise<void> {
    this.rows.set(attempt.username.value, attempt);
    return Promise.resolve();
  }

  clear(username: Username): Promise<void> {
    this.rows.delete(username.value);
    return Promise.resolve();
  }
}
