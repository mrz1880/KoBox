import type { HealthCheckResult, HealthProbePort, UserRepository } from '../../domain/user/ports.js';

interface Deps {
  readonly repo: UserRepository;
  readonly health: HealthProbePort;
}

const SCGI_HOST = '127.0.0.1';

// The probes `kobox doctor` and the admin Health screen both report: rtorrent
// alive, and each active member's SCGI socket answering (systemd "active" is
// not proof, AUDIT §3.7). Suspended members' services are down on purpose, so
// they are not probed. rtorrent runs one instance per member, so a box with no
// active member has no rtorrent to find: expecting one there reports a fresh
// install as broken.
export class ProbeSeedboxHealth {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<HealthCheckResult[]> {
    const active = (await this.deps.repo.listAll()).filter((user) => !user.status.isSuspended());
    if (active.length === 0) {
      return [];
    }
    const checks: HealthCheckResult[] = [await this.deps.health.checkProcess('rtorrent')];
    for (const user of active) {
      checks.push(await this.deps.health.checkSocket(SCGI_HOST, user.scgiPort.value));
    }
    return checks;
  }
}
