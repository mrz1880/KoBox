#!/usr/bin/env node
import { Command } from 'commander';
import { EventHook } from '../../domain/torrent/EventHook.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { LABEL_PATTERN, Label } from '../../domain/torrent/Label.js';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { Password } from '../../domain/user/Password.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import { TorrentEventSpoolWriter } from '../../infrastructure/spool/TorrentEventSpool.js';
import { buildContainer, buildInstallation, spoolDir, type Container } from '../composition.js';
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
  .description('report an rtorrent event (called by the KoBox shims)')
  .action((rawType: string, options: Record<string, string | undefined>) => {
    const hook = EventHook.parse(rawType);
    const submission: Record<string, string> = {
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
  're-render BIND zones, dnscrypt blocked-names and PGL allow.p2p',
  () => buildJob.renderWhitelist(),
);

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
