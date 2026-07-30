import type { ServiceControlPort, UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { UserNotFoundError } from '../user/errors.js';

export interface RestartRtorrentInstanceCommand {
  readonly username: Username;
}

export class SuspendedUserRestartError extends Error {
  constructor(username: string) {
    super(`refusing to restart rtorrent for suspended user ${username}`);
    this.name = 'SuspendedUserRestartError';
  }
}

interface Deps {
  readonly users: UserRepository;
  readonly services: ServiceControlPort;
}

// Self-service "my rtorrent is stuck, restart it" — the one thing the legacy
// Seedbox-Manager needed a setuid-root helper for. Here the privilege stays
// where it already is (the root worker); the user only enqueues a typed job.
//
// A SUSPENDED user is refused: suspension deliberately stops their instance, so
// restarting it would silently undo the sanction.
export class RestartRtorrentInstance {
  constructor(private readonly deps: Deps) {}

  async execute(command: RestartRtorrentInstanceCommand): Promise<void> {
    const user = await this.deps.users.findByUsername(command.username);
    if (user === undefined) {
      throw new UserNotFoundError(command.username.value);
    }
    if (user.status.isSuspended()) {
      throw new SuspendedUserRestartError(command.username.value);
    }
    await this.deps.services.restartUserService(command.username);
  }
}
