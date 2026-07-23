#!/usr/bin/env node
import { Command } from 'commander';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { HashedPassword } from '../../domain/user/HashedPassword.js';
import { Password } from '../../domain/user/Password.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import { buildContainer, type Container } from '../composition.js';
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
  .option('--quota-gib <number>', 'disk quota in GiB', '412')
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
        quota: Quota.gib(Number(options.quotaGib ?? '412')),
        proxyPort: ProxyPort.parse(Number(options.proxyPort ?? '8080')),
        passwordHash: HashedPassword.parse(hash.value),
      });
      await done(c, `user ${username} created`);
      return;
    }
    const job = await buildJob.createUser(
      {
        username,
        email: options.email ?? '',
        accountType: options.accountType ?? 'normal',
        quotaGib: Number(options.quotaGib ?? '412'),
        proxyPort: Number(options.proxyPort ?? '8080'),
      },
      password,
      c.hasher,
    );
    const id = await c.queue.enqueue(job);
    await done(c, `job ${String(id)} enqueued: create-user ${username}`);
  });

function usernameCommand(
  name: string,
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
      const job =
        name === 'delete-user'
          ? buildJob.deleteUser({ username: username.value })
          : name === 'suspend-user'
            ? buildJob.suspendUser({ username: username.value })
            : buildJob.resumeUser({ username: username.value });
      const id = await c.queue.enqueue(job);
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
    for (const user of users) {
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
