import { renderMemberPortReservation } from '../../domain/installation/rendering.js';
import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { MemberPort } from '../../domain/user/memberPortReservation.js';

// The ports ledger: every port currently handed to a member, whichever way it
// came (allocated from a pool, or kept from a MySB import).
export interface AllocatedPortsPort {
  listAllocated(): Promise<readonly MemberPort[]>;
}

// Loads one sysctl drop-in into the running kernel, now rather than at boot.
export interface KernelSettingsPort {
  load(path: string): Promise<void>;
}

interface Deps {
  readonly ledger: AllocatedPortsPort;
  readonly files: ManagedFilesPort;
  readonly kernel: KernelSettingsPort;
}

export class ReserveMemberPorts {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const { ledger, files, kernel } = this.deps;
    const reservation = renderMemberPortReservation(await ledger.listAllocated());
    const changed = await files.apply([reservation]);
    if (changed.length > 0) {
      await kernel.load(reservation.path);
    }
  }
}
