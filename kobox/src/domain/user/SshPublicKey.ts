import { DomainError } from '../shared/DomainError.js';

export class InvalidSshPublicKeyError extends DomainError {
  constructor(reason: string) {
    super(`invalid ssh public key: ${reason}`);
  }
}

// Types worth accepting in 2026. ssh-dss is broken and ssh-rsa with SHA-1 is on
// its way out, so only the two that a current client offers by default.
const ACCEPTED_TYPES = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384'] as const;
const BASE64 = /^[A-Za-z0-9+/]+={0,3}$/;
// a comment is free text but must not smuggle a newline back in
const COMMENT = /^[^\n\r]{0,255}$/;

// One public key, as a member pastes it. The value object exists for one
// reason: an authorized_keys line puts OPTIONS BEFORE the type, so a pasted
// `command="sh" ssh-ed25519 ...` would hand back the pty, the forwarding and
// the shell that KoBox deliberately withholds. Nothing downstream re-checks,
// so the check has to be here and it has to be strict.
export class SshPublicKey {
  private constructor(
    readonly type: string,
    readonly body: string,
    readonly comment: string,
  ) {}

  static parse(raw: string): SshPublicKey {
    const line = raw.trim();
    if (line.includes('\n') || line.includes('\r')) {
      throw new InvalidSshPublicKeyError('it must be a single line');
    }
    if (line.startsWith('-----BEGIN')) {
      throw new InvalidSshPublicKeyError('that is a private key, never paste one anywhere');
    }
    const [type, body, ...rest] = line.split(/\s+/);
    if (type === undefined || body === undefined) {
      throw new InvalidSshPublicKeyError('expected a type and a key');
    }
    if (!(ACCEPTED_TYPES as readonly string[]).includes(type)) {
      throw new InvalidSshPublicKeyError(
        `unsupported type ${JSON.stringify(type)}, expected one of ${ACCEPTED_TYPES.join(', ')}`,
      );
    }
    if (!BASE64.test(body) || body.length < 32 || body.length > 1024) {
      throw new InvalidSshPublicKeyError('the key itself is not base64 of a plausible length');
    }
    const comment = rest.join(' ');
    if (!COMMENT.test(comment)) {
      throw new InvalidSshPublicKeyError('the comment contains a line break');
    }
    return new SshPublicKey(type, body, comment);
  }

  // The line written to authorized_keys, options first. `restrict` turns off
  // pty, agent, port and X11 forwarding; the forced command makes this a
  // file-transfer credential and nothing else, which is what the key is for.
  toAuthorizedKeysLine(): string {
    return `restrict,command="internal-sftp" ${this.type} ${this.body}${
      this.comment === '' ? '' : ` ${this.comment}`
    }`;
  }

  get fingerprintSource(): string {
    return `${this.type} ${this.body}`;
  }
}
