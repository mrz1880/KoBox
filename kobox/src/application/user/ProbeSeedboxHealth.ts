import type { HealthCheckResult, HealthProbePort, UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

// A probe and, for a member's own socket, whose it is: a port number alone
// does not say whose rTorrent stopped answering.
export type SeedboxCheck = HealthCheckResult & { readonly member?: Username };

interface Deps {
  readonly repo: UserRepository;
  readonly health: HealthProbePort;
}

const SCGI_HOST = '127.0.0.1';

// The probes `kobox doctor` and the admin Health screen both report: rtorrent
// alive, and each active member's SCGI socket answering (systemd "active" is
// not proof). Suspended members' services are down on purpose, so
// they are not probed. rtorrent runs one instance per member, so a box with no
// active member has no rtorrent to find: expecting one there reports a fresh
// install as broken.
export class ProbeSeedboxHealth {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<SeedboxCheck[]> {
    const active = (await this.deps.repo.listAll()).filter((user) => !user.status.isSuspended());
    if (active.length === 0) {
      return [];
    }
    const checks: SeedboxCheck[] = [await this.deps.health.checkProcess('rtorrent')];
    for (const user of active) {
      checks.push({
        ...(await this.deps.health.checkSocket(SCGI_HOST, user.scgiPort.value)),
        member: user.username,
      });
    }
    return checks;
  }
}
