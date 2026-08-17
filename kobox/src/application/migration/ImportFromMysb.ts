import { parseJob } from '../jobs/contract.js';
import type { JobQueuePort } from '../jobs/JobQueuePort.js';
import type { MailOutboxPort } from '../maintenance/MailOutboxPort.js';
import type { DynDnsBindingRepository } from '../../domain/security/ports.js';
import type {
  BlocklistRepository,
  TrackerRepository,
  UserAddressRepository,
} from '../../domain/tracker/ports.js';
import { RecyclingMode } from '../../domain/torrent/RecyclingMode.js';
import { TorrentInstance } from '../../domain/torrent/TorrentInstance.js';
import type { TorrentInstanceRepository, TorrentRepository } from '../../domain/torrent/ports.js';
import type { Password } from '../../domain/user/Password.js';
import type { PasswordHasherPort, UserRepository } from '../../domain/user/ports.js';
import { CreateUser } from '../user/CreateUser.js';
import { SuspendUser } from '../user/SuspendUser.js';
import type { MysbSource } from './MysbSourcePort.js';
import {
  toBlocklist,
  toMappedAddress,
  toMappedUser,
  toTorrent,
  toTracker,
  type MappedUser,
} from './mappers.js';

export interface ConflictEntry {
  readonly key: string;
  readonly reason: string;
}

export interface CategoryReport {
  readonly imported: number;
  readonly conflicts: readonly ConflictEntry[];
}

export interface UserReport {
  readonly created: readonly string[];
  readonly alreadyImported: readonly string[];
  readonly conflicts: readonly ConflictEntry[];
}

export interface MigrationReport {
  readonly apply: boolean;
  readonly users: UserReport;
  readonly trackers: CategoryReport;
  readonly blocklists: CategoryReport;
  readonly torrents: CategoryReport;
  readonly addresses: CategoryReport;
}

interface Deps {
  readonly source: MysbSource;
  readonly users: UserRepository;
  readonly createUser: CreateUser;
  readonly suspendUser: SuspendUser;
  readonly instances: TorrentInstanceRepository;
  readonly trackers: TrackerRepository;
  readonly blocklists: BlocklistRepository;
  readonly torrents: TorrentRepository;
  readonly addresses: UserAddressRepository;
  readonly bindings: DynDnsBindingRepository;
  readonly hasher: PasswordHasherPort;
  readonly newTemporaryPassword: () => Password;
  readonly outbox: MailOutboxPort;
  readonly queue: JobQueuePort;
  readonly clock: () => string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Imports a frozen MySB dump into KoBox. Idempotent and re-entrant: a user that
// already exists is skipped (no second account, mail or provisioning), and every
// catalogue write is an upsert, so a re-run converges. Dry-run by default — the
// caller passes apply:true only after reviewing the diff. Desired-state: import
// the DATA, then let KoBox regenerate every file from it.
export class ImportFromMysb {
  constructor(private readonly deps: Deps) {}

  async execute(command: { readonly apply: boolean }): Promise<MigrationReport> {
    const apply = command.apply;
    const knownUsers = new Set<string>();
    const users: {
      created: string[];
      alreadyImported: string[];
      conflicts: ConflictEntry[];
    } = { created: [], alreadyImported: [], conflicts: [] };

    for (const dto of await this.deps.source.users()) {
      let mapped: MappedUser;
      try {
        mapped = toMappedUser(dto);
      } catch (error) {
        users.conflicts.push({ key: dto.username, reason: messageOf(error) });
        continue;
      }
      if (await this.deps.users.findByUsername(mapped.username)) {
        users.alreadyImported.push(mapped.username.value);
        knownUsers.add(mapped.username.value);
        // Repair: re-run the idempotent provisioning so a user who was created
        // but not fully provisioned (an interrupted earlier run) converges.
        // The account, flags and temp-password mail are NOT redone (once-only).
        if (apply) {
          await this.enqueueProvisioning(mapped.username.value);
        }
        continue;
      }
      if (!apply) {
        users.created.push(mapped.username.value);
        knownUsers.add(mapped.username.value);
        continue;
      }
      // Per-user isolation: a failure (e.g. a colliding port) is recorded and
      // the import moves on — one bad row must not abort the other users.
      try {
        await this.importUser(mapped);
        users.created.push(mapped.username.value);
        knownUsers.add(mapped.username.value);
      } catch (error) {
        users.conflicts.push({ key: mapped.username.value, reason: messageOf(error) });
      }
    }

    const trackers = await this.importTrackers(apply);
    const blocklists = await this.importBlocklists(apply);
    const torrents = await this.importTorrents(apply, knownUsers);
    const addresses = await this.importAddresses(apply, knownUsers);

    if (apply) {
      // reflect the imported trackers (whitelist) and member addresses (firewall);
      // blocklist ranges and tracker certs are left to KoBox's scheduled jobs.
      await this.deps.queue.enqueue(parseJob('render-whitelist', {}));
      await this.deps.queue.enqueue(parseJob('apply-firewall', {}));
    }

    return { apply, users, trackers, blocklists, torrents, addresses };
  }

  private async importUser(mapped: MappedUser): Promise<void> {
    const tempPassword = this.deps.newTemporaryPassword();
    const passwordHash = await this.deps.hasher.hash(tempPassword);
    await this.deps.createUser.execute({
      username: mapped.username,
      email: mapped.email,
      accountType: mapped.accountType,
      quota: mapped.quota,
      proxyPort: mapped.proxyPort,
      passwordHash,
      role: 'user',
      ports: { scgi: mapped.scgiPort, rtorrent: mapped.rtorrentPort },
      mustChangePassword: true,
    });
    // Pre-write the instance WITH its flags before provisioning: the worker's
    // provision-rtorrent preserves an existing instance and renders .rtorrent.rc
    // from it, so the flags survive (DB survives, files are regenerated).
    await this.deps.instances.save(
      TorrentInstance.restore({
        username: mapped.username,
        scgiPort: mapped.scgiPort,
        rtorrentPort: mapped.rtorrentPort,
        watchDirs: mapped.watchDirs,
        // Nobody arrives with the bypass, including whoever had it on MySB.
        // It existed because an XMLRPC add lost its privacy attribute and got
        // blocked as public; rTorrent now answers that question directly, so
        // the flag has no reason left to be on. Importing it would carry a
        // workaround past the thing it worked around.
        allowPublicTracker: false,
        // recycling stays off on import: it is a decision about disk and quotas
        // that the operator makes deliberately, not one a migration makes for them
        recycling: RecyclingMode.none,
        syncDisabled: mapped.syncDisabled,
      }),
    );
    await this.enqueueProvisioning(mapped.username.value);
    await this.deps.outbox.enqueue(
      {
        recipient: mapped.email.value,
        subject: 'Your KoBox seedbox is ready — set your password',
        body: welcomeBody(mapped.username.value, tempPassword),
      },
      this.deps.clock(),
    );
    if (mapped.suspended) {
      // CreateUser always starts active; restore the legacy suspended state.
      await this.deps.suspendUser.execute({ username: mapped.username });
    }
  }

  // The same provisioning fan-out the worker's create-user chain does, minus its
  // generic (passwordless) welcome mail. Every job here is idempotent, so it is
  // safe to re-enqueue on a repair re-run.
  private async enqueueProvisioning(username: string): Promise<void> {
    await this.deps.queue.enqueue(parseJob('provision-rtorrent', { username }));
    await this.deps.queue.enqueue(parseJob('provision-vpn-user', { username }));
    await this.deps.queue.enqueue(parseJob('render-nfs-exports', {}));
  }

  private async importTrackers(apply: boolean): Promise<CategoryReport> {
    let imported = 0;
    const conflicts: ConflictEntry[] = [];
    for (const dto of await this.deps.source.trackers()) {
      try {
        const tracker = toTracker(dto);
        if (apply) {
          await this.deps.trackers.save(tracker);
        }
        imported += 1;
      } catch (error) {
        conflicts.push({ key: dto.host, reason: messageOf(error) });
      }
    }
    return { imported, conflicts };
  }

  private async importBlocklists(apply: boolean): Promise<CategoryReport> {
    let imported = 0;
    const conflicts: ConflictEntry[] = [];
    for (const dto of await this.deps.source.blocklists()) {
      const key = `${dto.source}/${dto.author}/${dto.name}`;
      try {
        const blocklist = toBlocklist(dto);
        if (apply) {
          await this.deps.blocklists.save(blocklist);
        }
        imported += 1;
      } catch (error) {
        conflicts.push({ key, reason: messageOf(error) });
      }
    }
    return { imported, conflicts };
  }

  private async importTorrents(apply: boolean, knownUsers: Set<string>): Promise<CategoryReport> {
    let imported = 0;
    const conflicts: ConflictEntry[] = [];
    for (const dto of await this.deps.source.torrents()) {
      const key = `${dto.username}/${dto.infoHash}`;
      if (!knownUsers.has(dto.username)) {
        conflicts.push({ key, reason: 'unknown user' });
        continue;
      }
      try {
        const { username, torrent } = toTorrent(dto);
        if (apply) {
          await this.deps.torrents.upsert(username, torrent);
        }
        imported += 1;
      } catch (error) {
        conflicts.push({ key, reason: messageOf(error) });
      }
    }
    return { imported, conflicts };
  }

  private async importAddresses(apply: boolean, knownUsers: Set<string>): Promise<CategoryReport> {
    let imported = 0;
    const conflicts: ConflictEntry[] = [];
    for (const dto of await this.deps.source.addresses()) {
      const key = `${dto.username}/${dto.value}`;
      if (!knownUsers.has(dto.username)) {
        conflicts.push({ key, reason: 'unknown user' });
        continue;
      }
      try {
        const mapped = toMappedAddress(dto);
        if (apply) {
          if (mapped.kind === 'ipv4') {
            await this.deps.addresses.add(mapped.username, mapped.ip);
          } else {
            await this.deps.bindings.addHostname(mapped.username, mapped.hostname);
          }
        }
        imported += 1;
      } catch (error) {
        conflicts.push({ key, reason: messageOf(error) });
      }
    }
    return { imported, conflicts };
  }
}

function welcomeBody(username: string, tempPassword: Password): string {
  return [
    `Hello ${username},`,
    '',
    'Your seedbox has moved to KoBox. Sign in to the portal with:',
    `  username: ${username}`,
    `  temporary password: ${tempPassword.reveal()}`,
    '',
    'You will be asked to choose a new password immediately after signing in.',
  ].join('\n');
}
