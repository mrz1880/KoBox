import { DomainError } from '../shared/DomainError.js';
import type { RtorrentPort, ScgiPort } from './Port.js';

// Contract: allocation MUST be atomic (no read-then-write race) — the legacy
// max()+1 pattern raced concurrent user creations (AUDIT §5.3, issues #56/#69).
export interface PortAllocatorPort {
  allocateScgiPort(): Promise<ScgiPort>;
  allocateRtorrentPort(): Promise<RtorrentPort>;
  // Compensation path: a failed provisioning must hand its ports back.
  releaseScgiPort(port: ScgiPort): Promise<void>;
  releaseRtorrentPort(port: RtorrentPort): Promise<void>;
  // Import path (Phase 7 migration): claim a specific legacy port so it is
  // preserved verbatim and later allocations step over it. This keeps a
  // migrated user's in-flight torrents on their existing SCGI/rtorrent ports.
  claimScgiPort(port: ScgiPort): Promise<void>;
  claimRtorrentPort(port: RtorrentPort): Promise<void>;
}

export class PortAlreadyClaimedError extends DomainError {
  constructor(port: number) {
    super(`port ${port} is already allocated`);
  }
}
