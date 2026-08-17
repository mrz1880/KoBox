#!/usr/bin/env node
import { Command } from 'commander';
import { DebridApiKey } from '../../domain/ddl/DebridApiKey.js';

import { FilehosterLink } from '../../domain/ddl/FilehosterLink.js';
import { EventHook } from '../../domain/torrent/EventHook.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { LABEL_PATTERN, Label } from '../../domain/torrent/Label.js';
import { SyncMode } from '../../domain/torrent/SyncMode.js';
import { LoneFilePlacement } from '../../domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../domain/sync/RemoteHost.js';
import { RemotePassword } from '../../domain/sync/RemotePassword.js';
import { RemotePath } from '../../domain/sync/RemotePath.js';
import { RemotePort } from '../../domain/sync/RemotePort.js';
import { SendHour } from '../../domain/sync/SendHour.js';
import { TransferBatchSize } from '../../domain/sync/TransferBatchSize.js';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { Password } from '../../domain/user/Password.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import { ConfigureMailRelay } from '../../application/maintenance/ConfigureMailRelay.js';
import { RestoreBackup } from '../../application/maintenance/RestoreBackup.js';
import { BackupHostAdapter } from '../../infrastructure/system/BackupHostAdapter.js';
import { ExecFileRunner, runOrThrow } from '../../infrastructure/system/CommandRunner.js';
import { InstallHostAdapter } from '../../infrastructure/system/InstallHostAdapter.js';
import { RtorrentConfigAdapter } from '../../infrastructure/system/RtorrentConfigAdapter.js';
import { SystemdAdapter } from '../../infrastructure/system/SystemdAdapter.js';
import { TorrentEventSpoolWriter } from '../../infrastructure/spool/TorrentEventSpool.js';
import {
  buildContainer,
  buildInstallation,
  buildMigrateFromMysb,
  buildUpgrade,
  spoolDir,
  DEFAULT_DB_PATH,
  type Container,
} from '../composition.js';
import { buildJob } from './buildJob.js';

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) {
    data += String(chunk);
  }
  return data.trim();
}

async function readPassword(): Promise<Password> {
  return Password.parse(await readStdin());
}

interface GlobalOptions {
  readonly direct?: boolean;
}

function container(): Container {
  return buildContainer('kobox-cli');
}

async function done(c: Container, message: string): Promise<void> {
  await Promise.resolve();
  c.db.close();
  process.stdout.write(`${message}\n`);
}

const program = new Command('kobox')
  .description('KoBox seedbox manager (Phase 0: user management)')
  .option('--direct', 'execute immediately in-process instead of enqueueing a job (requires root)');

program
  .command('create-user')
  .argument('<username>')
  .requiredOption('--email <email>')
  .option('--quota-gib <number>', 'disk quota in GiB', '500')
  .option('--account-type <type>', 'normal|plex', 'normal')
  .option('--proxy-port <port>', 'shared proxy port', '8080')
  .option('--admin', 'grant the portal admin role')
  .description('create a seedbox user (password read from stdin)')
  .action(async (username: string, options: Record<string, string>) => {
    const { direct } = program.opts<GlobalOptions>();
    const password = await readPassword();
    const c = container();
    if (direct) {
      const hash = await c.hasher.hash(password);
      await c.useCases.createUser.execute({
        username: Username.parse(username),
        email: EmailAddress.parse(options.email ?? ''),
        accountType: AccountType.parse(options.accountType ?? 'normal'),
        quota: Quota.gib(Number(options.quotaGib ?? '500')),
        proxyPort: ProxyPort.parse(Number(options.proxyPort ?? '8080')),
        passwordHash: hash,
        role: options.admin === undefined ? 'user' : 'admin',
      });
      await done(c, `user ${username} created`);
      return;
    }
    const job = await buildJob.createUser(
      {
        username,
        email: options.email ?? '',
        accountType: options.accountType ?? 'normal',
        quotaGib: Number(options.quotaGib ?? '500'),
        proxyPort: Number(options.proxyPort ?? '8080'),
        role: options.admin === undefined ? 'user' : 'admin',
      },
      password,
      c.hasher,
    );
    const id = await c.queue.enqueue(job);
    await done(c, `job ${String(id)} enqueued: create-user ${username}`);
  });

const USERNAME_JOB_BUILDERS = {
  'delete-user': (input: { username: string }) => buildJob.deleteUser(input),
  'suspend-user': (input: { username: string }) => buildJob.suspendUser(input),
  'resume-user': (input: { username: string }) => buildJob.resumeUser(input),
  'provision-rtorrent': (input: { username: string }) => buildJob.provisionRtorrent(input),
  'restart-rtorrent': (input: { username: string }) => buildJob.restartRtorrent(input),
  'render-rtorrent-config': (input: { username: string }) => buildJob.renderRtorrentConfig(input),
} as const;

function usernameCommand(
  name: keyof typeof USERNAME_JOB_BUILDERS,
  description: string,
  run: (c: Container, username: Username) => Promise<void>,
): void {
  program
    .command(name)
    .argument('<username>')
    .description(description)
    .action(async (raw: string) => {
      const { direct } = program.opts<GlobalOptions>();
      const username = Username.parse(raw);
      const c = container();
      if (direct) {
        await run(c, username);
        await done(c, `${name} ${username.value}: done`);
        return;
      }
      const id = await c.queue.enqueue(USERNAME_JOB_BUILDERS[name]({ username: username.value }));
      await done(c, `job ${String(id)} enqueued: ${name} ${username.value}`);
    });
}

usernameCommand('delete-user', 'delete a seedbox user and its resources', (c, username) =>
  c.useCases.deleteUser.execute({ username }),
);
usernameCommand('restart-rtorrent', 'restart a user rtorrent instance', (c, username) =>
  c.torrentUseCases.restart.execute({ username }),
);
usernameCommand('suspend-user', 'reversibly cut SSH/SFTP/rtorrent for a user', (c, username) =>
  c.useCases.suspendUser.execute({ username }),
);
usernameCommand('resume-user', 'restore a suspended user to full service', (c, username) =>
  c.useCases.resumeUser.execute({ username }),
);
usernameCommand(
  'provision-rtorrent',
  'provision the per-user rtorrent instance (config, dirs, systemd unit)',
  async (c, username) => {
    await c.torrentUseCases.provision.execute({ username });
  },
);
usernameCommand(
  'render-rtorrent-config',
  're-render managed rtorrent files, restart only if changed and running',
  async (c, username) => {
    await c.torrentUseCases.render.execute({ username });
  },
);

program
  .command('set-sync-destination')
  .argument('<username>')
  .argument('<host>')
  .argument('<port>')
  .argument('<account>')
  .argument('<path>', 'absolute directory on the member\'s own machine')
  .option('--batch-size <n>', 'files per pass, 0 for everything waiting', '0')
  .option('--lone-file <placement>', 'beside-the-others | in-its-own-folder', 'beside-the-others')
  .option('--send-hour <h>', 'hour of day the scheduled folders go out', '2')
  .description("set where a member's finished downloads are copied (password on stdin)")
  .action(
    async (
      rawUser: string,
      rawHost: string,
      rawPort: string,
      rawAccount: string,
      rawPath: string,
      options: { batchSize: string; loneFile: string; sendHour: string },
    ) => {
      // stdin, never an argument: a password on the command line is readable in
      // `ps` by every other member of the box
      const secret = (await readStdin()).trim();
      const c = container();
      await c.setDestination.execute({
        username: Username.parse(rawUser),
        host: RemoteHost.parse(rawHost),
        port: RemotePort.parse(Number(rawPort)),
        account: RemoteAccount.parse(rawAccount),
        path: RemotePath.parse(rawPath),
        batchSize: TransferBatchSize.parse(Number(options.batchSize)),
        placement: LoneFilePlacement.parse(options.loneFile),
        sendHour: SendHour.parse(Number(options.sendHour)),
        ...(secret !== '' && { password: RemotePassword.parse(secret) }),
      });
      await done(c, `destination set for ${rawUser}`);
    },
  );

program
  .command('send-pending-transfers')
  .description('carry waiting downloads to members whose hour has come (cron entry point)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.sendPendingTransfers());
    await done(
      c,
      id === undefined
        ? 'send-pending-transfers already pending'
        : `job ${String(id)} enqueued: send-pending-transfers`,
    );
  });

program
  .command('check-sync-destination')
  .argument('<username>')
  .description("test a member's destination from the root worker and record the verdict")
  .action(async (rawUser: string) => {
    const { direct } = program.opts<GlobalOptions>();
    const username = Username.parse(rawUser);
    const c = container();
    if (direct) {
      await c.syncUseCases.checkDestination.execute(username);
      await done(c, `destination checked for ${username.value}`);
      return;
    }
    const id = await c.queue.enqueueUnique(
      buildJob.checkSyncDestination({ username: username.value }),
    );
    await done(
      c,
      id === undefined
        ? 'a check is already pending'
        : `job ${String(id)} enqueued: check-sync-destination ${username.value}`,
    );
  });

program
  .command('set-category-sync-mode')
  .argument('<username>')
  .argument('<label>')
  .argument('<mode>', 'off | scheduled | immediate')
  .description('choose what happens to a finished download in that category')
  .action(async (rawUser: string, rawLabel: string, rawMode: string) => {
    const { direct } = program.opts<GlobalOptions>();
    const username = Username.parse(rawUser);
    const label = Label.parse(rawLabel);
    const mode = SyncMode.parse(rawMode);
    const c = container();
    if (direct) {
      await c.torrentUseCases.setCategorySyncMode.execute({ username, label, mode });
      await done(c, `${label.value} set to ${mode.value} for ${username.value}`);
      return;
    }
    const id = await c.queue.enqueue(
      buildJob.setCategorySyncMode({
        username: username.value,
        label: label.value,
        mode: mode.value,
      }),
    );
    await done(
      c,
      `job ${String(id)} enqueued: set-category-sync-mode ${username.value} ${label.value}`,
    );
  });

program
  .command('add-watch-dir')
  .argument('<username>')
  .argument('<label>')
  .description('add a labeled watch directory (custom1) to a user instance')
  .action(async (rawUser: string, rawLabel: string) => {
    const { direct } = program.opts<GlobalOptions>();
    const username = Username.parse(rawUser);
    const label = Label.parse(rawLabel);
    const c = container();
    if (direct) {
      await c.torrentUseCases.addWatchDir.execute({ username, label });
      await done(c, `watch dir ${label.value} added for ${username.value}`);
      return;
    }
    const id = await c.queue.enqueue(
      buildJob.addWatchDir({ username: username.value, label: label.value }),
    );
    await done(c, `job ${String(id)} enqueued: add-watch-dir ${username.value} ${label.value}`);
  });

function flagCommand(
  name: 'set-sync-disabled' | 'set-allow-public-tracker',
  description: string,
): void {
  program
    .command(name)
    .argument('<username>')
    .argument('<state>', 'on|off')
    .description(description)
    .action(async (rawUser: string, rawState: string) => {
      if (rawState !== 'on' && rawState !== 'off') {
        throw new Error(`state must be "on" or "off", got ${JSON.stringify(rawState)}`);
      }
      const { direct } = program.opts<GlobalOptions>();
      const username = Username.parse(rawUser);
      const value = rawState === 'on';
      const c = container();
      if (direct) {
        if (name === 'set-sync-disabled') {
          await c.torrentUseCases.setSyncDisabled.execute({ username, disabled: value });
        } else {
          await c.torrentUseCases.setAllowPublicTracker.execute({ username, allowed: value });
        }
        await done(c, `${name} ${username.value}: ${rawState}`);
        return;
      }
      const job =
        name === 'set-sync-disabled'
          ? buildJob.setSyncDisabled({ username: username.value, disabled: value })
          : buildJob.setAllowPublicTracker({ username: username.value, allowed: value });
      const id = await c.queue.enqueue(job);
      await done(c, `job ${String(id)} enqueued: ${name} ${username.value} ${rawState}`);
    });
}

flagCommand(
  'set-sync-disabled',
  'per-user DB flag: skip the post-download script fan-out (survives restarts)',
);
flagCommand(
  'set-allow-public-tracker',
  'per-user DB flag: accept torrents from public trackers (survives restarts)',
);

// The unprivileged event path: rtorrent shims call this AS the seedbox user.
// It never opens the database — it drops an owner-authenticated file into the
// spool; the root worker derives the username from the file owner.
program
  .command('torrent-event')
  .argument('<type>', 'inserted_new|finished|erased')
  .requiredOption('--hash <infoHash>')
  .option('--name <name>')
  .option('--directory <path>')
  .option('--base-path <path>')
  .option('--torrent-file <path>')
  .option('--label <label>')
  // rTorrent's d.is_private, as "1" or "0": the only privacy source that exists
  // for an XMLRPC add, which carries no .torrent file
  .option('--is-private <flag>')
  .description('report an rtorrent event (called by the KoBox shims)')
  .action((rawType: string, options: Record<string, string | undefined>) => {
    const hook = EventHook.parse(rawType);
    const submission: Record<string, string | boolean> = {
      event: hook.type,
      infoHash: InfoHash.parse(options.hash ?? '').value,
    };
    const optional: Record<string, string | undefined> = {
      name: options.name,
      directory: options.directory,
      basePath: options.basePath,
      torrentFile: options.torrentFile,
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined && value !== '') {
        submission[key] = value;
      }
    }
    // rTorrent prints d.is_private as 1 or 0. Anything else (an older shim, an
    // empty value) is left out rather than guessed: the handler would rather
    // skip the torrent than decide wrongly about somebody's tracker.
    if (options.isPrivate === '1' || options.isPrivate === '0') {
      // a real boolean into the spool: the job contract asks for one, and the
      // "1"/"0" that rTorrent prints is this boundary's business, not the
      // worker's
      submission.isPrivate = options.isPrivate === '1';
    }
    // labels can come from ruTorrent free text: forward only what the
    // contract will accept, dropping the field beats dropping the event
    if (options.label !== undefined && LABEL_PATTERN.test(options.label)) {
      submission.label = options.label;
    }
    const path = new TorrentEventSpoolWriter(spoolDir()).submit(submission);
    process.stdout.write(`event spooled: ${path}\n`);
  });

// ---- Tracker & Blocklist (Phase 2) --------------------------------------

program
  .command('discover-tracker')
  .argument('<url>', 'announce URL (http/https/udp)')
  .option('--privacy <privacy>', 'public|private', 'private')
  .description('register a tracker from an announce URL (resolves DNS, schedules cert check)')
  .action(async (url: string, options: Record<string, string>) => {
    const c = container();
    const id = await c.queue.enqueue(
      buildJob.discoverTracker({ url, privacy: options.privacy ?? 'private' }),
    );
    await done(c, `job ${String(id)} enqueued: discover-tracker ${url}`);
  });

function trackerHostCommand(
  name: 'fetch-tracker-cert' | 'mark-tracker-dead',
  description: string,
): void {
  program
    .command(name)
    .argument('<host>')
    .description(description)
    .action(async (host: string) => {
      const c = container();
      const job =
        name === 'fetch-tracker-cert'
          ? buildJob.fetchTrackerCert({ host })
          : buildJob.markTrackerDead({ host });
      const id = await c.queue.enqueue(job);
      await done(c, `job ${String(id)} enqueued: ${name} ${host}`);
    });
}

trackerHostCommand('fetch-tracker-cert', 'probe a tracker over TLS and install its certificate');
trackerHostCommand(
  'mark-tracker-dead',
  'deactivate a tracker (blacklisted in DNS, removed from allow.p2p)',
);

program
  .command('renew-tracker-certs')
  .description('check every tracker whose certificate is due (cron entry point)')
  .action(async () => {
    const c = container();
    const today = new Date().toISOString().slice(0, 10);
    const id = await c.queue.enqueueUnique(buildJob.renewTrackerCerts({ today }));
    await done(
      c,
      id === undefined
        ? `renew-tracker-certs ${today} already pending`
        : `job ${String(id)} enqueued: renew-tracker-certs ${today}`,
    );
  });

// cron re-runs these blindly every tick: enqueueUnique keeps a stopped
// worker from accumulating a duplicate backlog (they are all idempotent)
function parameterlessTrackerCommand(
  name: 'import-blocklist-catalog' | 'update-blocklists' | 'render-whitelist',
  description: string,
  build: () => ReturnType<typeof buildJob.renderWhitelist>,
): void {
  program
    .command(name)
    .description(description)
    .action(async () => {
      const c = container();
      const id = await c.queue.enqueueUnique(build());
      await done(
        c,
        id === undefined ? `${name} already pending` : `job ${String(id)} enqueued: ${name}`,
      );
    });
}

parameterlessTrackerCommand(
  'import-blocklist-catalog',
  'import/refresh the iblocklist catalog into the database',
  () => buildJob.importBlocklistCatalog(),
);
parameterlessTrackerCommand(
  'update-blocklists',
  'download every enabled blocklist (verified) and refresh the merged cache',
  () => buildJob.updateBlocklists(),
);
parameterlessTrackerCommand(
  'render-whitelist',
  're-render the BIND blacklist zones and dnscrypt blocked-names',
  () => buildJob.renderWhitelist(),
);

program
  .command('apply-ipset')
  .description('load the merged blocklist into the kernel kobox-bl ipset (atomic swap)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.applyIpset());
    await done(
      c,
      id === undefined ? 'apply-ipset already pending' : `job ${String(id)} enqueued: apply-ipset`,
    );
  });

program
  .command('render-blocklist-filters')
  .argument('[username]')
  .description('re-render per-user rtorrent ipv4 filter files from the merged cache')
  .action(async (rawUser: string | undefined) => {
    const c = container();
    const username = rawUser === undefined ? undefined : Username.parse(rawUser).value;
    const id = await c.queue.enqueue(
      buildJob.renderBlocklistFilters(username === undefined ? {} : { username }),
    );
    await done(c, `job ${String(id)} enqueued: render-blocklist-filters ${username ?? '(all)'}`);
  });

function userAddressCommand(name: 'add-user-address' | 'remove-user-address'): void {
  program
    .command(name)
    .argument('<username>')
    .argument('<ipv4>')
    .description(`${name === 'add-user-address' ? 'allow' : 'revoke'} a user IPv4 in the whitelist`)
    .action(async (rawUser: string, ipv4: string) => {
      const c = container();
      const input = { username: Username.parse(rawUser).value, ipv4 };
      const job =
        name === 'add-user-address'
          ? buildJob.addUserAddress(input)
          : buildJob.removeUserAddress(input);
      const id = await c.queue.enqueue(job);
      await done(c, `job ${String(id)} enqueued: ${name} ${input.username} ${ipv4}`);
    });
}

userAddressCommand('add-user-address');
userAddressCommand('remove-user-address');

// ---- Security & Network (Phase 3) ---------------------------------------

program
  .command('apply-firewall')
  .description('reconcile the declarative default-deny firewall (guarded iptables-restore)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueue(buildJob.applyFirewall());
    await done(c, `job ${String(id)} enqueued: apply-firewall`);
  });

program
  .command('render-fail2ban')
  .description('re-render fail2ban jails (incl. publickey-flood) and reload when changed')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueue(buildJob.renderFail2ban());
    await done(c, `job ${String(id)} enqueued: render-fail2ban`);
  });

function userHostnameCommand(name: 'add-user-hostname' | 'remove-user-hostname'): void {
  program
    .command(name)
    .argument('<username>')
    .argument('<hostname>')
    .description(
      `${name === 'add-user-hostname' ? 'track' : 'stop tracking'} a DynDNS hostname for a user (restrict IP)`,
    )
    .action(async (rawUser: string, hostname: string) => {
      const c = container();
      const input = { username: Username.parse(rawUser).value, hostname };
      const job =
        name === 'add-user-hostname'
          ? buildJob.addUserHostname(input)
          : buildJob.removeUserHostname(input);
      const id = await c.queue.enqueue(job);
      await done(c, `job ${String(id)} enqueued: ${name} ${input.username} ${hostname}`);
    });
}

userHostnameCommand('add-user-hostname');
userHostnameCommand('remove-user-hostname');

program
  .command('resolve-dyndns')
  .description('re-resolve DynDNS hostnames; refreshes whitelist/firewall/fail2ban on change')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.resolveDynDns());
    await done(
      c,
      id === undefined
        ? 'resolve-dyndns already pending'
        : `job ${String(id)} enqueued: resolve-dyndns`,
    );
  });

program
  .command('evaluate-fair-use')
  .description('meter usage per user and run the graduated response (cron entry point)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.evaluateFairUse());
    await done(
      c,
      id === undefined
        ? 'evaluate-fair-use already pending'
        : `job ${String(id)} enqueued: evaluate-fair-use`,
    );
  });

program
  .command('send-mails')
  .description('flush the pending mail outbox through the Postfix relay (cron entry point)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.sendMails());
    await done(
      c,
      id === undefined ? 'send-mails already pending' : `job ${String(id)} enqueued: send-mails`,
    );
  });

program
  .command('poll-debrid-downloads')
  .description('advance in-flight debrid downloads (cron entry point)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.pollDebridDownloads());
    await done(
      c,
      id === undefined
        ? 'poll-debrid-downloads already pending'
        : `job ${String(id)} enqueued: poll-debrid-downloads`,
    );
  });

program
  .command('request-download')
  .argument('<username>')
  .argument('<link>')
  .option('--category <films|series>', 'target complete/ subdir', 'films')
  .description('queue a filehoster link for debrid unlock + download (unprivileged entry point)')
  .action(async (username: string, link: string, options: Record<string, string>) => {
    const c = container();
    const id = await c.ddlUseCases.requestDownload.execute({
      username: Username.parse(username),
      category: Label.parse(options.category ?? 'films'),
      link: FilehosterLink.parse(link),
    });
    await done(c, `download ${String(id)} requested for ${username}`);
  });

program
  .command('set-debrid-key')
  .argument('<username>')
  .description('set a user AllDebrid key (read from stdin; sealed before it enters the queue)')
  .action(async (username: string) => {
    const raw = await readStdin();
    const c = container();
    // sealed here, exactly like the portal does: the plaintext never enters the
    // job payload, the database or a log line
    const encryptedKey = await c.debridCipher.encrypt(DebridApiKey.parse(raw));
    const id = await c.queue.enqueue(
      buildJob.setDebridKey({ username: Username.parse(username).value, encryptedKey }),
    );
    await done(c, `job ${String(id)} enqueued: set-debrid-key ${username}`);
  });

program
  .command('clear-debrid-key')
  .argument('<username>')
  .description('remove a user stored AllDebrid key')
  .action(async (username: string) => {
    const c = container();
    const id = await c.queue.enqueue(
      buildJob.clearDebridKey({ username: Username.parse(username).value }),
    );
    await done(c, `job ${String(id)} enqueued: clear-debrid-key ${username}`);
  });

program
  .command('index-media')
  .description('refresh the per-user media listing (cron entry point)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.indexMedia());
    await done(
      c,
      id === undefined ? 'index-media already pending' : `job ${String(id)} enqueued: index-media`,
    );
  });

program
  .command('run-speedtest')
  .description('measure what the link can carry (saturates it — admin action, never scheduled)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.runSpeedtest());
    await done(
      c,
      id === undefined
        ? 'a measurement is already running'
        : `job ${String(id)} enqueued: run-speedtest`,
    );
  });

program
  .command('check-package-updates')
  .description('record what apt considers upgradable (cron entry point)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.checkPackageUpdates());
    await done(
      c,
      id === undefined
        ? 'check-package-updates already pending'
        : `job ${String(id)} enqueued: check-package-updates`,
    );
  });

program
  .command('run-backup')
  .description('dump the database and KoBox configs into a TTL-rotated backup (cron entry point)')
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueueUnique(buildJob.runBackup());
    await done(
      c,
      id === undefined ? 'run-backup already pending' : `job ${String(id)} enqueued: run-backup`,
    );
  });

program
  .command('sample-disk-usage')
  .description('record what the disk holds for each member, for the portal to read')
  .action(async () => {
    const c = container();
    await c.useCases.sampleDiskUsage.execute();
    process.stdout.write('disk usage sampled\n');
  });

program
  .command('show-usage')
  .description('print per-user usage, fair-use state and recent audit events as JSON')
  .action(async () => {
    const c = container();
    const counters = new Map(
      (await c.usageMeter.readCounters()).map((counter) => [counter.username, counter]),
    );
    const rows = [];
    for (const user of await c.repo.listAll()) {
      const state = await c.fairUseRepo.getState(user.username);
      const events = await c.fairUseRepo.listEvents(user.username);
      rows.push({
        username: user.username.value,
        status: user.status.value,
        level: state.level,
        health: state.healthState,
        egressBytes: counters.get(user.username.value)?.egressBytes ?? 0,
        ingressBytes: counters.get(user.username.value)?.ingressBytes ?? 0,
        recentEvents: events.slice(-5),
      });
    }
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    c.db.close();
  });

// "clear" resets that budget dimension to the installation default; a number
// overrides it for this user only.
function parseOverride(raw: string | undefined): number | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'clear') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`expected a positive integer or "clear", got ${JSON.stringify(raw)}`);
  }
  return value;
}

program
  .command('set-fair-use-override')
  .argument('<username>')
  .option('--egress-bps <n|clear>', 'sustained egress budget override, bits per second')
  .option('--auth-per-hour <n|clear>', 'SSH auth rate budget override')
  .option('--throttle-bps <n|clear>', 'throttle target override, bits per second')
  .description('override the fair-use budget for one user (audited)')
  .action(async (username: string, options: Record<string, string>) => {
    const c = container();
    const egressLimitBps = parseOverride(options.egressBps);
    const authRatePerHour = parseOverride(options.authPerHour);
    const throttleToBps = parseOverride(options.throttleBps);
    const id = await c.queue.enqueue(
      buildJob.setFairUseOverride({
        username,
        ...(egressLimitBps !== undefined && { egressLimitBps }),
        ...(authRatePerHour !== undefined && { authRatePerHour }),
        ...(throttleToBps !== undefined && { throttleToBps }),
      }),
    );
    await done(c, `job ${String(id)} enqueued: set-fair-use-override ${username}`);
  });

program
  .command('render-openvpn')
  .description(
    're-render OpenVPN server configs and client profiles (no restart: tunnels stay up)',
  )
  .action(async () => {
    const c = container();
    const id = await c.queue.enqueue(buildJob.renderOpenVpn());
    await done(c, `job ${String(id)} enqueued: render-openvpn`);
  });

program
  .command('list-trackers')
  .description('print the tracker whitelist as JSON (operator view)')
  .action(async () => {
    const c = container();
    const rows = (await c.trackerRepo.listAll()).map((tracker) => ({
      host: tracker.host.value,
      proto: tracker.proto.value,
      port: tracker.port.value,
      privacy: tracker.privacy.value,
      active: tracker.isActive,
      dead: tracker.isDead,
      ssl: tracker.isSsl,
      checkState: tracker.checkState.value,
      certExpiration: tracker.certExpiry?.value ?? null,
      lastCheck: tracker.lastCheck ?? null,
      ipv4: tracker.ipv4.map((ip) => ip.value),
    }));
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    c.db.close();
  });

program
  .command('change-password')
  .argument('<username>')
  .description('change a user password (password read from stdin)')
  .action(async (raw: string) => {
    const { direct } = program.opts<GlobalOptions>();
    const username = Username.parse(raw);
    const password = await readPassword();
    const c = container();
    if (direct) {
      const hash = await c.hasher.hash(password);
      await c.useCases.changePassword.execute({ username, passwordHash: hash });
      await done(c, `password changed for ${username.value}`);
      return;
    }
    const job = await buildJob.changePassword({ username: username.value }, password, c.hasher);
    const id = await c.queue.enqueue(job);
    await done(c, `job ${String(id)} enqueued: change-password ${username.value}`);
  });

// ---- Installation & Provisioning (Phase 4) ------------------------------

program
  .command('install')
  .option('--allow-non-ext4', 'proceed on a non-ext4 root filesystem (containers/VMs)')
  .option('--manage-apt-sources', 'let KoBox own /etc/apt/sources.list (canonical Debian 12)')
  .description('install the KoBox stack on this host (direct root execution, resumable)')
  .action(async (options: Record<string, boolean | undefined>) => {
    const c = container();
    try {
      const wiring = await buildInstallation(c, {
        allowNonExt4: options.allowNonExt4 === true,
        manageAptSources: options.manageAptSources === true,
      });
      const report = await wiring.run.execute({ allowNonExt4: options.allowNonExt4 === true });
      const summary = {
        installed: report.installed,
        skipped: report.skipped,
        alreadyInstalled: report.alreadyInstalled,
        convergenceJobs: report.drainedJobs,
      };
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } finally {
      c.db.close();
    }
  });

program
  .command('migrate-from-mysb')
  .requiredOption('--dump <dir>', 'directory holding the frozen MySB dump (mysb.sqlite + sync/)')
  .option('--apply', 'write the import (default is a read-only dry-run)')
  .option('--dry-run', 'preview only, writing nothing (the default)')
  .description('import users and data from a frozen MySB dump (dry-run by default)')
  .action(async (options: { dump: string; apply?: boolean; dryRun?: boolean }) => {
    const c = container();
    try {
      const importer = buildMigrateFromMysb(c, { dumpDir: options.dump });
      const report = await importer.execute({ apply: options.apply === true });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
      c.db.close();
    }
  });

program
  .command('install-status')
  .description('print the component registry as JSON')
  .action(async () => {
    const c = container();
    try {
      const wiring = await buildInstallation(c, { allowNonExt4: false, manageAptSources: false });
      const rows = (await wiring.registry.list()).map((record) => ({
        name: record.name.value,
        state: record.state.value,
        version: record.version?.value ?? null,
        reason: record.reason ?? null,
        installedAt: record.installedAt ?? null,
      }));
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    } finally {
      c.db.close();
    }
  });

program
  .command('uninstall')
  .option('--yes', 'confirm the teardown')
  .description('uninstall KoBox-managed units and files (keeps packages, user data and the DB)')
  .action(async (options: Record<string, boolean | undefined>) => {
    if (options.yes !== true) {
      throw new Error('refusing to uninstall without --yes');
    }
    const c = container();
    try {
      const wiring = await buildInstallation(c, { allowNonExt4: false, manageAptSources: false });
      const report = await wiring.uninstall.execute();
      process.stdout.write(`${JSON.stringify({ uninstalled: report.uninstalled }, null, 2)}\n`);
    } finally {
      c.db.close();
    }
  });

program
  .command('configure-mail-relay')
  .requiredOption('--host <fqdn>', 'SMTP relay hostname')
  .requiredOption('--port <port>', 'SMTP relay port (e.g. 587)')
  .requiredOption('--user <login>', 'SASL login (password read from stdin)')
  .description('wire Postfix to an authenticated SMTP relay (direct root, secret stays on disk 0600)')
  .action(async (options: Record<string, string>) => {
    // no container: this command touches Postfix only, never the database
    const password = await readStdin();
    const runner = new ExecFileRunner();
    const configure = new ConfigureMailRelay({
      files: new RtorrentConfigAdapter(runner),
      host: new InstallHostAdapter(runner),
      systemd: new SystemdAdapter(runner),
    });
    await configure.execute({
      host: options.host ?? '',
      port: Number(options.port ?? '0'),
      user: options.user ?? '',
      password,
    });
    process.stdout.write('postfix relay configured (sasl_passwd 0600, postmap, reload)\n');
  });

program
  .command('set-samba-password')
  .argument('<username>')
  .description('set a user Samba password (read from stdin; direct root, never in the DB or a job)')
  .action(async (username: string) => {
    // no container: the secret goes straight to smbpasswd via stdin and never
    // touches the database or a job payload (AUDIT §5.5)
    const password = await readStdin();
    const name = Username.parse(username).value;
    const runner = new ExecFileRunner();
    // -s: read from stdin (new password + confirmation); -a: add/update
    await runOrThrow(runner, {
      command: 'smbpasswd',
      args: ['-s', '-a', name],
      stdin: `${password}\n${password}\n`,
    });
    process.stdout.write(`samba password set for ${name}\n`);
  });

program
  .command('migrate')
  .description('apply pending database migrations and exit (used by kobox upgrade)')
  .action(async () => {
    // migrations run inside KoboxDatabase.open — reaching this line means
    // the schema is current
    const c = container();
    await done(c, 'database schema is up to date');
  });

program
  .command('upgrade')
  .option('--to <ref>', 'git tag or commit to upgrade to (pinned, verified to exist)')
  .option('--rollback', 'switch back to the previous release')
  .option('--offline', 'skip git fetch (air-gapped or already-fetched repos)')
  .description('transactional upgrade: staged worktree, build, backup, migrate, atomic switch')
  .action(async (options: Record<string, string | boolean | undefined>) => {
    const c = container();
    try {
      const upgrade = buildUpgrade(c);
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      if (options.rollback === true) {
        const report = await upgrade.rollback({ now });
        process.stdout.write(`rolled back to ${report.to} (${report.path})\n`);
        return;
      }
      const to = typeof options.to === 'string' ? options.to : '';
      if (to === '') {
        throw new Error('kobox upgrade requires --to <ref> (or --rollback)');
      }
      const report = await upgrade.execute({
        to,
        now,
        ...(options.offline === true && { offline: true }),
      });
      process.stdout.write(
        `upgraded ${report.from ?? '(unrecorded)'} -> ${report.to} (${report.sha})\nDB backup: ${report.backupDir}\n`,
      );
    } finally {
      c.db.close();
    }
  });

program
  .command('restore-backup')
  .argument('<backupDir>', 'backup directory (e.g. /var/backups/kobox/20260725T053000Z)')
  .option('--yes', 'confirm the restore')
  .description('restore the database from a backup (stops the worker; old DB kept aside)')
  .action(async (backupDir: string, options: Record<string, boolean | undefined>) => {
    if (options.yes !== true) {
      throw new Error('refusing to restore without --yes');
    }
    // no container: opening the live DB here would hold the file we replace
    const runner = new ExecFileRunner();
    const restore = new RestoreBackup({
      backupHost: new BackupHostAdapter(runner),
      systemd: new SystemdAdapter(runner),
      liveDbPath: process.env.KOBOX_DB ?? DEFAULT_DB_PATH,
    });
    const report = await restore.execute({ backupDir });
    process.stdout.write(
      `restored ${report.restoredFrom}\nprevious database kept at ${report.asidePath}\n`,
    );
  });

program
  .command('doctor')
  .description('run health probes and print JSON results')
  .action(async () => {
    const c = container();
    const users = await c.repo.listAll();
    const checks = [];
    // suspended users' services are down on purpose — do not probe them
    for (const user of users.filter((u) => !u.status.isSuspended())) {
      checks.push(await c.healthProbe.checkSocket('127.0.0.1', user.scgiPort.value));
    }
    checks.push(await c.healthProbe.checkProcess('rtorrent'));
    const healthy = checks.every((check) => check.state === 'healthy');
    process.stdout.write(`${JSON.stringify({ healthy, checks }, null, 2)}\n`);
    c.db.close();
    process.exitCode = healthy ? 0 : 1;
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
