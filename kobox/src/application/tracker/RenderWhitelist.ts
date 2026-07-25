import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type {
  NetworkServiceReloadPort,
  TrackerRepository,
} from '../../domain/tracker/ports.js';
import {
  renderBlacklistZones,
  renderBlockedNames,
} from '../../domain/tracker/rendering.js';

export interface WhitelistReport {
  readonly changedFiles: readonly string[];
}

interface Deps {
  readonly trackers: TrackerRepository;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServiceReloadPort;
}

// Whole-state render of the DNS-side network files (BIND zones, dnscrypt
// blocked-names). Idempotent: unchanged content means zero writes and zero
// service reloads — the end of the legacy refresh storms. allow.p2p is gone
// with pgl (Phase 5): member trust lives in the firewall's trusted accepts.
export class RenderWhitelist {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<WhitelistReport> {
    const { trackers, files, reload } = this.deps;
    const allTrackers = await trackers.listAll();

    const changedFiles = await files.apply([
      renderBlacklistZones(allTrackers),
      renderBlockedNames(allTrackers),
    ]);

    if (changedFiles.length > 0) {
      await reload.reloadDns();
    }
    return { changedFiles };
  }
}
