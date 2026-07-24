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
import { buildContainer, spoolDir, type Container } from '../composition.js';
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
  .option('--torrent-dir <path>')
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
      torrentDir: options.torrentDir,
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
