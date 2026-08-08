import type { SystemdPort } from '../../domain/installation/ports.js';
import type { ManagedService } from '../../domain/maintenance/ManagedService.js';

export interface RestartServiceCommand {
  readonly service: ManagedService;
}

interface Deps {
  readonly systemd: SystemdPort;
}

// Restarts one of the units KoBox manages. The closed ManagedService type is the
// guard: an arbitrary unit name never reaches systemctl.
export class RestartService {
  constructor(private readonly deps: Deps) {}

  async execute(command: RestartServiceCommand): Promise<void> {
    await this.deps.systemd.reloadOrRestart(command.service.value);
  }
}
