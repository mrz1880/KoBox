import type { RtorrentPort, ScgiPort } from './Port.js';

// Contract: allocation MUST be atomic (no read-then-write race) — the legacy
// max()+1 pattern raced concurrent user creations (AUDIT §5.3, issues #56/#69).
export interface PortAllocatorPort {
  allocateScgiPort(): Promise<ScgiPort>;
  allocateRtorrentPort(): Promise<RtorrentPort>;
}
