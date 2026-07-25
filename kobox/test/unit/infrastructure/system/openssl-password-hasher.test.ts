import { describe, expect, it } from 'vitest';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { OpensslPasswordHasher } from '../../../../src/infrastructure/system/OpensslPasswordHasher.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';

const STORED = '$6$saltsalt$4tYAmwvGF0kBIVfCJlic9NGvGtBXTNRnAt2ZAyk9OtGF6bg';

class StubRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly stdout: string) {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return Promise.resolve({ stdout: this.stdout, stderr: '', exitCode: 0 });
  }
}

describe('OpensslPasswordHasher.verify', () => {
  it('should_accept_when_recomputing_with_the_stored_salt_yields_the_same_hash', async () => {
    const runner = new StubRunner(`${STORED}\n`);
    const hasher = new OpensslPasswordHasher(runner);

    const ok = await hasher.verify(Password.parse('s3cretpw!'), HashedPassword.parse(STORED));

    expect(ok).toBe(true);
    expect(runner.requests[0]?.command).toBe('openssl');
    expect(runner.requests[0]?.args).toEqual(['passwd', '-6', '-salt', 'saltsalt', '-stdin']);
    expect(runner.requests[0]?.stdin).toBe('s3cretpw!\n');
  });

  it('should_reject_when_the_recomputed_hash_differs', async () => {
    const runner = new StubRunner(
      '$6$saltsalt$completelyDifferentDigestValue0123456789abcdefghijk\n',
    );
    const hasher = new OpensslPasswordHasher(runner);

    const ok = await hasher.verify(Password.parse('wrong-password'), HashedPassword.parse(STORED));

    expect(ok).toBe(false);
  });

  it('should_reject_hash_formats_it_cannot_recompute_without_running_openssl', async () => {
    const runner = new StubRunner('anything');
    const hasher = new OpensslPasswordHasher(runner);

    const ok = await hasher.verify(
      Password.parse('s3cretpw!'),
      HashedPassword.parse('$y$j9T$salt$hashhashhashhash'),
    );

    expect(ok).toBe(false);
    expect(runner.requests).toHaveLength(0);
  });
});
