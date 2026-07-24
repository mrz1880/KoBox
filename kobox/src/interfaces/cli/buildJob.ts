import { parseJob, type Job } from '../../application/jobs/contract.js';
import type { Password } from '../../domain/user/Password.js';
import type { PasswordHasherPort } from '../../domain/user/ports.js';

const BYTES_PER_GIB = 1024 ** 3;

export interface CreateUserInput {
  readonly username: string;
  readonly email: string;
  readonly accountType: string;
  readonly quotaGib: number;
  readonly proxyPort: number;
}

// The unprivileged side of the seam: plaintext is hashed here and dies here;
// parseJob validates the payload before it ever reaches the queue.
export const buildJob = {
  async createUser(
    input: CreateUserInput,
    password: Password,
    hasher: PasswordHasherPort,
  ): Promise<Job> {
    const passwordHash = (await hasher.hash(password)).value;
    return parseJob('create-user', {
      username: input.username,
      email: input.email,
      accountType: input.accountType,
      quotaBytes: Math.round(input.quotaGib * BYTES_PER_GIB),
      proxyPort: input.proxyPort,
      passwordHash,
    });
  },

  async changePassword(
    input: { username: string },
    password: Password,
    hasher: PasswordHasherPort,
  ): Promise<Job> {
    const passwordHash = (await hasher.hash(password)).value;
    return parseJob('change-password', { username: input.username, passwordHash });
  },

  deleteUser(input: { username: string }): Job {
    return parseJob('delete-user', { username: input.username });
  },

  suspendUser(input: { username: string }): Job {
    return parseJob('suspend-user', { username: input.username });
  },

  resumeUser(input: { username: string }): Job {
    return parseJob('resume-user', { username: input.username });
  },

  provisionRtorrent(input: { username: string }): Job {
    return parseJob('provision-rtorrent', { username: input.username });
  },

  renderRtorrentConfig(input: { username: string }): Job {
    return parseJob('render-rtorrent-config', { username: input.username });
  },

  addWatchDir(input: { username: string; label: string }): Job {
    return parseJob('add-watch-dir', input);
  },

  setSyncDisabled(input: { username: string; disabled: boolean }): Job {
    return parseJob('set-sync-disabled', input);
  },

  setAllowPublicTracker(input: { username: string; allowed: boolean }): Job {
    return parseJob('set-allow-public-tracker', input);
  },

  discoverTracker(input: { url: string; privacy: string }): Job {
    return parseJob('discover-tracker', input);
  },

  fetchTrackerCert(input: { host: string }): Job {
    return parseJob('fetch-tracker-cert', input);
  },

  renewTrackerCerts(input: { today: string }): Job {
    return parseJob('renew-tracker-certs', input);
  },

  markTrackerDead(input: { host: string }): Job {
    return parseJob('mark-tracker-dead', input);
  },

  importBlocklistCatalog(): Job {
    return parseJob('import-blocklist-catalog', {});
  },

  updateBlocklists(): Job {
    return parseJob('update-blocklists', {});
  },

  renderWhitelist(): Job {
    return parseJob('render-whitelist', {});
  },

  renderBlocklistFilters(input: { username?: string }): Job {
    return parseJob('render-blocklist-filters', input);
  },

  addUserAddress(input: { username: string; ipv4: string }): Job {
    return parseJob('add-user-address', input);
  },

  removeUserAddress(input: { username: string; ipv4: string }): Job {
    return parseJob('remove-user-address', input);
  },

  applyFirewall(): Job {
    return parseJob('apply-firewall', {});
  },

  renderFail2ban(): Job {
    return parseJob('render-fail2ban', {});
  },

  addUserHostname(input: { username: string; hostname: string }): Job {
    return parseJob('add-user-hostname', input);
  },

  removeUserHostname(input: { username: string; hostname: string }): Job {
    return parseJob('remove-user-hostname', input);
  },

  resolveDynDns(): Job {
    return parseJob('resolve-dyndns', {});
  },

  renderOpenVpn(): Job {
    return parseJob('render-openvpn', {});
  },
};
