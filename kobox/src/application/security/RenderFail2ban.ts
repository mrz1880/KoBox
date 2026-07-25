import type { NetworkServicePort } from '../../domain/security/ports.js';
import {
  renderFail2banJails,
  renderPortalLoginFilter,
  renderPublickeyFloodFilter,
} from '../../domain/security/rendering.js';
import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { UserAddressRepository } from '../../domain/tracker/ports.js';
import type { SecuritySettings } from './settings.js';

export interface Fail2banReport {
  readonly changedFiles: readonly string[];
}

interface Deps {
  readonly addresses: UserAddressRepository;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServicePort;
  readonly settings: SecuritySettings;
}

// Whole-state render of the fail2ban drop-ins. ignoreip carries every
// resolved user address, so a member's own flood never bans their home IP —
// the ban is for strangers, the graduated fair-use response is for members.
export class RenderFail2ban {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<Fail2banReport> {
    const { addresses, files, reload, settings } = this.deps;
    const userIps = (await addresses.listAll()).map((address) => address.ip);

    const changedFiles = await files.apply([
      renderFail2banJails(userIps, settings.sshPort),
      renderPublickeyFloodFilter(),
      renderPortalLoginFilter(),
    ]);

    if (changedFiles.length > 0) {
      await reload.reloadFail2ban();
    }
    return { changedFiles };
  }
}
