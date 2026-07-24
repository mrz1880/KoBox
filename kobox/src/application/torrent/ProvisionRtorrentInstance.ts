import { TorrentInstance } from '../../domain/torrent/TorrentInstance.js';
import type {
  RtorrentConfigPort,
  TorrentInstanceRepository,
  WatchDirPort,
} from '../../domain/torrent/ports.js';
import {
  renderHomeFiles,
  renderUnit,
  type RenderSettings,
  type RtorrentTemplates,
} from '../../domain/torrent/rendering.js';
import type { ServiceControlPort, UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { UserNotFoundError } from '../user/errors.js';

export interface ProvisionRtorrentInstanceCommand {
  readonly username: Username;
}

export interface ProvisionReport {
  readonly changedFiles: readonly string[];
}

interface Deps {
  readonly users: UserRepository;
  readonly instances: TorrentInstanceRepository;
  readonly config: RtorrentConfigPort;
  readonly watchDirs: WatchDirPort;
  readonly services: ServiceControlPort;
  readonly templates: RtorrentTemplates;
  readonly settings: RenderSettings;
}

// Fully idempotent: desired state is derived from the aggregate and applied
// write-if-changed; re-running converges with zero side effects. This also
// pays the Phase 0 debt — the rtorrent-<user> unit finally exists for real.
export class ProvisionRtorrentInstance {
  constructor(private readonly deps: Deps) {}

  async execute(command: ProvisionRtorrentInstanceCommand): Promise<ProvisionReport> {
    const { users, instances, config, watchDirs, services, templates, settings } = this.deps;

    const user = await users.findByUsername(command.username);
    if (!user) {
      throw new UserNotFoundError(command.username.value);
    }

    let instance = await instances.findByUsername(command.username);
    if (!instance) {
      instance = TorrentInstance.provision({
        username: user.username,
        scgiPort: user.scgiPort,
        rtorrentPort: user.rtorrentPort,
      }).instance;
      await instances.save(instance);
    }

    await watchDirs.ensureLayout(instance.username, instance.watchDirs);
    const changedFiles = await config.apply(renderHomeFiles(instance, templates, settings));
    await services.installUserService(instance.username, renderUnit(instance, templates));
    if (!user.status.isSuspended()) {
      await services.startUserService(instance.username);
    }
    return { changedFiles };
  }
}
