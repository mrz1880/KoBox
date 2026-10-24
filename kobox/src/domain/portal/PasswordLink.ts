import { DomainError } from '../shared/DomainError.js';
import type { Username } from '../user/Username.js';
import { shift } from './policy.js';

// Why a member is handed a link to choose their password: they were just
// invited, or they forgot it.
export const PASSWORD_LINK_PURPOSES = ['invitation', 'reset'] as const;
export type PasswordLinkPurpose = (typeof PASSWORD_LINK_PURPOSES)[number];

const HOUR_MS = 60 * 60_000;

// An invitation waits for someone to read their mail; a reset answers a
// request the member made a minute ago, and is worth less the longer it lies
// in a mailbox.
const LIFETIME_MS: Record<PasswordLinkPurpose, number> = {
  invitation: 7 * 24 * HOUR_MS,
  reset: HOUR_MS,
};

export class PasswordLinkClosedError extends DomainError {
  constructor() {
    super('this password link no longer works');
  }
}

interface PasswordLinkProps {
  readonly username: Username;
  readonly purpose: PasswordLinkPurpose;
  // sha256 of the token in the link: the token itself is never stored
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly usedAt?: string;
}

// A single-use way for a member to choose their password, without anyone else
// ever knowing it. Timestamps follow the 'YYYY-MM-DD HH:MM:SS' UTC convention.
export class PasswordLink {
  readonly username: Username;
  readonly purpose: PasswordLinkPurpose;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly usedAt: string | undefined;

  private constructor(props: PasswordLinkProps) {
    this.username = props.username;
    this.purpose = props.purpose;
    this.tokenHash = props.tokenHash;
    this.expiresAt = props.expiresAt;
    this.usedAt = props.usedAt;
  }

  static issue(props: {
    readonly username: Username;
    readonly purpose: PasswordLinkPurpose;
    readonly tokenHash: string;
    readonly now: string;
  }): PasswordLink {
    return new PasswordLink({
      username: props.username,
      purpose: props.purpose,
      tokenHash: props.tokenHash,
      expiresAt: shift(props.now, LIFETIME_MS[props.purpose]),
    });
  }

  // Rehydration from persistence: state is whatever was stored.
  static restore(props: PasswordLinkProps): PasswordLink {
    return new PasswordLink(props);
  }

  isOpen(now: string): boolean {
    return this.usedAt === undefined && now < this.expiresAt;
  }

  use(now: string): PasswordLink {
    if (!this.isOpen(now)) {
      throw new PasswordLinkClosedError();
    }
    return new PasswordLink({ ...this.props(), usedAt: now });
  }

  private props(): PasswordLinkProps {
    return {
      username: this.username,
      purpose: this.purpose,
      tokenHash: this.tokenHash,
      expiresAt: this.expiresAt,
      ...(this.usedAt !== undefined && { usedAt: this.usedAt }),
    };
  }
}
