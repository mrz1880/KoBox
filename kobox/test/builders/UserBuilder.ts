import { AccountType } from '../../src/domain/user/AccountType.js';
import { EmailAddress } from '../../src/domain/user/EmailAddress.js';
import { ProxyPort, RtorrentPort, ScgiPort } from '../../src/domain/user/Port.js';
import { Quota } from '../../src/domain/user/Quota.js';
import { SeedboxUser } from '../../src/domain/user/SeedboxUser.js';
import { Username } from '../../src/domain/user/Username.js';

export class UserBuilder {
  private username = Username.parse('alice');
  private email = EmailAddress.parse('alice@example.org');
  private readonly accountType = AccountType.normal;
  private quota = Quota.gib(412);
  private scgiPort = ScgiPort.parse(51101);
  private rtorrentPort = RtorrentPort.parse(45000);
  private readonly proxyPort = ProxyPort.parse(8080);

  withUsername(raw: string): this {
    this.username = Username.parse(raw);
    return this;
  }

  withEmail(raw: string): this {
    this.email = EmailAddress.parse(raw);
    return this;
  }

  withQuota(quota: Quota): this {
    this.quota = quota;
    return this;
  }

  withScgiPort(port: number): this {
    this.scgiPort = ScgiPort.parse(port);
    return this;
  }

  withRtorrentPort(port: number): this {
    this.rtorrentPort = RtorrentPort.parse(port);
    return this;
  }

  suspended(): SeedboxUser {
    return this.build().suspend().user;
  }

  build(): SeedboxUser {
    return SeedboxUser.create({
      username: this.username,
      email: this.email,
      accountType: this.accountType,
      quota: this.quota,
      scgiPort: this.scgiPort,
      rtorrentPort: this.rtorrentPort,
      proxyPort: this.proxyPort,
    }).user;
  }
}

export function aUser(): UserBuilder {
  return new UserBuilder();
}
