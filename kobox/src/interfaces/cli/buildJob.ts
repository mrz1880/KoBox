import { parseJob, type Job } from '../../application/jobs/contract.js';
import type { Password } from '../../domain/user/Password.js';
import type { PasswordHasherPort } from '../../domain/user/ports.js';

const BYTES_PER_GIB = 1024 ** 3;

export interface CreateUserInput {
  readonly username: string;
  readonly email: string;
  readonly accountType: string;
  readonly quotaGib: number;
  readonly proxyPort: number;
}

// The unprivileged side of the seam: plaintext is hashed here and dies here;
// parseJob validates the payload before it ever reaches the queue.
export const buildJob = {
  async createUser(
    input: CreateUserInput,
    password: Password,
    hasher: PasswordHasherPort,
  ): Promise<Job> {
    const passwordHash = (await hasher.hash(password)).value;
    return parseJob('create-user', {
      username: input.username,
      email: input.email,
      accountType: input.accountType,
      quotaBytes: Math.round(input.quotaGib * BYTES_PER_GIB),
      proxyPort: input.proxyPort,
      passwordHash,
    });
  },

  async changePassword(
    input: { username: string },
    password: Password,
    hasher: PasswordHasherPort,
  ): Promise<Job> {
    const passwordHash = (await hasher.hash(password)).value;
    return parseJob('change-password', { username: input.username, passwordHash });
  },

  deleteUser(input: { username: string }): Job {
    return parseJob('delete-user', { username: input.username });
  },

  suspendUser(input: { username: string }): Job {
    return parseJob('suspend-user', { username: input.username });
  },

  resumeUser(input: { username: string }): Job {
    return parseJob('resume-user', { username: input.username });
  },
};
