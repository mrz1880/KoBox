import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type {
  NetworkServiceReloadPort,
  TrackerRepository,
  UserAddressRepository,
} from '../../domain/tracker/ports.js';
import {
  renderAllowP2p,
  renderBlacklistZones,
  renderBlockedNames,
} from '../../domain/tracker/rendering.js';

export interface WhitelistReport {
  readonly changedFiles: readonly string[];
}

interface Deps {
  readonly trackers: TrackerRepository;
  readonly addresses: UserAddressRepository;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServiceReloadPort;
}

// Whole-state render of the three network files (BIND zones, dnscrypt
// blocked-names, PGL allow.p2p). Idempotent: unchanged content means zero
// writes and zero service reloads — the end of the legacy refresh storms.
export class RenderWhitelist {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<WhitelistReport> {
    const { trackers, addresses, files, reload } = this.deps;
    const allTrackers = await trackers.listAll();
    const users = await addresses.listAll();

    const changedFiles = await files.apply([
      renderBlacklistZones(allTrackers),
      renderBlockedNames(allTrackers),
      renderAllowP2p(users, allTrackers),
    ]);

    if (changedFiles.length > 0) {
      await reload.reloadDns();
      await reload.reloadPeerGuardian();
    }
    return { changedFiles };
  }
}
