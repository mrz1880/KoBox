import { DomainError } from '../shared/DomainError.js';

export class InvalidRemotePasswordError extends DomainError {
  constructor(reason: string) {
    super(`invalid remote password: ${reason}`);
  }
}

// The password of an account on somebody else's machine. Opaque, like Password
// and DebridApiKey: reveal() is the only way out, and only the adapter that
// hands it to ssh may call it. toString/toJSON stay redacted so it cannot leak
// through a log line, a rendered template or a serialized error.
//
// No charset rule beyond "not empty, not absurd": it is their NAS's policy that
// decides what a valid password looks like, not ours. It never reaches a shell
// — it goes to sshpass through the environment, never through an argv.
export class RemotePassword {
  private constructor(private readonly secret: string) {}

  static parse(raw: string): RemotePassword {
    if (raw.length === 0) {
      throw new InvalidRemotePasswordError('it is empty');
    }
    if (raw.length > 256) {
      throw new InvalidRemotePasswordError('longer than 256 characters');
    }
    if (raw.includes('\n') || raw.includes('\0')) {
      // sshpass reads it as one line from the environment
      throw new InvalidRemotePasswordError('it contains a line break');
    }
    return new RemotePassword(raw);
  }

  reveal(): string {
    return this.secret;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }
}
