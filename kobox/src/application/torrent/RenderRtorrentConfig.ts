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
import type { ServiceControlPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

export interface RenderRtorrentConfigCommand {
  readonly username: Username;
}

export interface RenderReport {
  readonly changedFiles: readonly string[];
  readonly restarted: boolean;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly config: RtorrentConfigPort;
  readonly watchDirs: WatchDirPort;
  readonly services: ServiceControlPort;
  readonly templates: RtorrentTemplates;
  readonly settings: RenderSettings;
}

// Re-derives every managed file from the aggregate. rtorrent only reads its
// config at startup, so a restart happens ONLY when content actually changed
// AND the instance is running — never the legacy restart-storm.
export class RenderRtorrentConfig {
  constructor(private readonly deps: Deps) {}

  async execute(command: RenderRtorrentConfigCommand): Promise<RenderReport> {
    const { instances, config, watchDirs, services, templates, settings } = this.deps;

    const instance = await instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }

    await watchDirs.ensureLayout(instance.username, instance.watchDirs);
    const changedFiles = await config.apply(renderHomeFiles(instance, templates, settings));
    await services.installUserService(instance.username, renderUnit(instance, templates));

    let restarted = false;
    if (changedFiles.length > 0 && (await services.isUserServiceRunning(instance.username))) {
      await services.restartUserService(instance.username);
      restarted = true;
    }
    return { changedFiles, restarted };
  }
}
