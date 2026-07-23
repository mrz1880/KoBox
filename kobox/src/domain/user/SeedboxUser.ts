import type { AccountType } from './AccountType.js';
import type { EmailAddress } from './EmailAddress.js';
import type { ProxyPort, RtorrentPort, ScgiPort } from './Port.js';
import type { Quota } from './Quota.js';
import type { UserId } from './UserId.js';
import { UserStatus } from './UserStatus.js';
import type { Username } from './Username.js';
import type { UserCreated, UserResumed, UserSuspended } from './events.js';

interface SeedboxUserProps {
  readonly id?: UserId;
  readonly username: Username;
  readonly email: EmailAddress;
  readonly accountType: AccountType;
  readonly quota: Quota;
  readonly scgiPort: ScgiPort;
  readonly rtorrentPort: RtorrentPort;
  readonly proxyPort: ProxyPort;
  readonly status: UserStatus;
}

export class SeedboxUser {
  readonly id: UserId | undefined;
  readonly username: Username;
  readonly email: EmailAddress;
  readonly accountType: AccountType;
  readonly quota: Quota;
  readonly scgiPort: ScgiPort;
  readonly rtorrentPort: RtorrentPort;
  readonly proxyPort: ProxyPort;
  readonly status: UserStatus;

  private constructor(props: SeedboxUserProps) {
    this.id = props.id;
    this.username = props.username;
    this.email = props.email;
    this.accountType = props.accountType;
    this.quota = props.quota;
    this.scgiPort = props.scgiPort;
    this.rtorrentPort = props.rtorrentPort;
    this.proxyPort = props.proxyPort;
    this.status = props.status;
  }

  static create(
    props: Omit<SeedboxUserProps, 'status' | 'id'>,
  ): { user: SeedboxUser; event: UserCreated } {
    const user = new SeedboxUser({ ...props, status: UserStatus.active });
    return { user, event: { type: 'UserCreated', username: user.username.value } };
  }

  // Rehydration from persistence — no event, state is whatever was stored.
  static restore(props: SeedboxUserProps): SeedboxUser {
    return new SeedboxUser(props);
  }

  suspend(): { user: SeedboxUser; event?: UserSuspended } {
    if (this.status.isSuspended()) {
      return { user: this };
    }
    return {
      user: new SeedboxUser({ ...this.props(), status: UserStatus.suspended }),
      event: { type: 'UserSuspended', username: this.username.value },
    };
  }

  resume(): { user: SeedboxUser; event?: UserResumed } {
    if (!this.status.isSuspended()) {
      return { user: this };
    }
    return {
      user: new SeedboxUser({ ...this.props(), status: UserStatus.active }),
      event: { type: 'UserResumed', username: this.username.value },
    };
  }

  withQuota(quota: Quota): SeedboxUser {
    return new SeedboxUser({ ...this.props(), quota });
  }

  identifiedBy(id: UserId): SeedboxUser {
    return new SeedboxUser({ ...this.props(), id });
  }

  private props(): SeedboxUserProps {
    return {
      ...(this.id !== undefined && { id: this.id }),
      username: this.username,
      email: this.email,
      accountType: this.accountType,
      quota: this.quota,
      scgiPort: this.scgiPort,
      rtorrentPort: this.rtorrentPort,
      proxyPort: this.proxyPort,
      status: this.status,
    };
  }
}
