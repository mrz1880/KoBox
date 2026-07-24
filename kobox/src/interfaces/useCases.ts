import { AddWatchDir } from '../application/torrent/AddWatchDir.js';
import { DeprovisionRtorrentInstance } from '../application/torrent/DeprovisionRtorrentInstance.js';
import { HandleTorrentEvent } from '../application/torrent/HandleTorrentEvent.js';
import { ProvisionRtorrentInstance } from '../application/torrent/ProvisionRtorrentInstance.js';
import { RenderRtorrentConfig } from '../application/torrent/RenderRtorrentConfig.js';
import { SetAllowPublicTracker } from '../application/torrent/SetAllowPublicTracker.js';
import { SetSyncDisabled } from '../application/torrent/SetSyncDisabled.js';
import { ChangePassword } from '../application/user/ChangePassword.js';
import { CreateUser } from '../application/user/CreateUser.js';
import { DeleteUser } from '../application/user/DeleteUser.js';
import { ResumeUser } from '../application/user/ResumeUser.js';
import { SuspendUser } from '../application/user/SuspendUser.js';
import type {
  RtorrentConfigPort,
  RtorrentControlPort,
  TorrentInstanceRepository,
  TorrentMetainfoPort,
  TorrentRepository,
  UserScriptRunnerPort,
  WatchDirPort,
} from '../domain/torrent/ports.js';
import type { RenderSettings, RtorrentTemplates } from '../domain/torrent/rendering.js';
import type { PortAllocatorPort } from '../domain/user/PortAllocatorPort.js';
import type {
  NotificationPort,
  QuotaPort,
  ServiceControlPort,
  SftpPort,
  SystemAccountPort,
  UserRepository,
} from '../domain/user/ports.js';

export interface UseCaseDeps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly quota: QuotaPort;
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
  readonly allocator: PortAllocatorPort;
}

export interface UseCases {
  readonly createUser: CreateUser;
  readonly deleteUser: DeleteUser;
  readonly changePassword: ChangePassword;
  readonly suspendUser: SuspendUser;
  readonly resumeUser: ResumeUser;
}

export function buildUseCases(deps: UseCaseDeps): UseCases {
  return {
    createUser: new CreateUser(deps),
    deleteUser: new DeleteUser(deps),
    changePassword: new ChangePassword(deps),
    suspendUser: new SuspendUser(deps),
    resumeUser: new ResumeUser(deps),
  };
}

export interface TorrentUseCaseDeps {
  readonly users: UserRepository;
  readonly instances: TorrentInstanceRepository;
  readonly torrents: TorrentRepository;
  readonly config: RtorrentConfigPort;
  readonly watchDirs: WatchDirPort;
  readonly services: ServiceControlPort;
  readonly metainfo: TorrentMetainfoPort;
  readonly control: RtorrentControlPort;
  readonly scripts: UserScriptRunnerPort;
  readonly templates: RtorrentTemplates;
  readonly settings: RenderSettings;
}

export interface TorrentUseCases {
  readonly provision: ProvisionRtorrentInstance;
  readonly deprovision: DeprovisionRtorrentInstance;
  readonly render: RenderRtorrentConfig;
  readonly addWatchDir: AddWatchDir;
  readonly setSyncDisabled: SetSyncDisabled;
  readonly setAllowPublicTracker: SetAllowPublicTracker;
  readonly handleEvent: HandleTorrentEvent;
}

export function buildTorrentUseCases(deps: TorrentUseCaseDeps): TorrentUseCases {
  const render = new RenderRtorrentConfig(deps);
  return {
    provision: new ProvisionRtorrentInstance(deps),
    deprovision: new DeprovisionRtorrentInstance(deps),
    render,
    addWatchDir: new AddWatchDir({ instances: deps.instances, render }),
    setSyncDisabled: new SetSyncDisabled(deps),
    setAllowPublicTracker: new SetAllowPublicTracker(deps),
    handleEvent: new HandleTorrentEvent(deps),
  };
}
