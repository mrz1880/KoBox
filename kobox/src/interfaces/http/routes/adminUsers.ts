import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import { USERNAME_PATTERN } from '../../../domain/user/Username.js';
import { Password } from '../../../domain/user/Password.js';
import { Username } from '../../../domain/user/Username.js';
import type { TorrentInstanceRepository } from '../../../domain/torrent/ports.js';
import type { PasswordHasherPort, UserRepository } from '../../../domain/user/ports.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import { adminUserDetailPage, adminUsersPage } from '../views/adminUsersPage.js';

const createUserSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN),
  email: z.email(),
  password: z.string().min(8).max(256),
  quotaGib: z.coerce.number().int().positive(),
  accountType: z.enum(['normal', 'plex']),
  role: z.enum(['admin', 'user']),
});

const passwordSchema = z.object({ password: z.string().min(8).max(256) });

const usernameParamSchema = z.object({ name: z.string().regex(USERNAME_PATTERN) });

export interface AdminUsersDeps {
  readonly users: UserRepository;
  readonly queue: JobQueuePort;
  readonly hasher: PasswordHasherPort;
  readonly instances: TorrentInstanceRepository;
}

// Every mutation is an enqueue of the same typed jobs the CLI produces; the
// portal holds no privileged port (AUDIT §3.5).
// What each action is called from the operator's side, rather than the job type
// name that happens to implement it.
const ACTION_WORDS: Readonly<Record<string, string>> = {
  delete: 'Deleting',
  suspend: 'Suspending',
  resume: 'Restoring',
};

export function registerAdminUserRoutes(
  server: FastifyInstance,
  deps: AdminUsersDeps,
  guards: Guards,
): void {
  server.get('/admin/users', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const users = await deps.users.listAll();
    return reply
      .type('text/html')
      .send(adminUsersPage(users, viewerOf(session), flashOf(request)));
  });

  server.post('/admin/users', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).type('text/html').send(
        adminUsersPage(await deps.users.listAll(), viewerOf(session), undefined),
      );
    }
    const job = await buildJob.createUser(
      {
        username: parsed.data.username,
        email: parsed.data.email,
        accountType: parsed.data.accountType,
        quotaGib: parsed.data.quotaGib,
        proxyPort: 8080,
        role: parsed.data.role,
      },
      Password.parse(parsed.data.password),
      deps.hasher,
    );
    await deps.queue.enqueue(job);
    return redirectWithFlash(reply, '/admin/users', `Creating ${parsed.data.username}.`);
  });

  server.get('/admin/users/:name', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    const user = params.success
      ? await deps.users.findByUsername(Username.parse(params.data.name))
      : undefined;
    if (user === undefined) {
      return reply.code(404).type('text/html').send('Not found');
    }
    const instance = await deps.instances.findByUsername(user.username);
    return reply
      .type('text/html')
      .send(adminUserDetailPage(user, viewerOf(session), instance, flashOf(request)));
  });

  const lifecycle = [
    ['suspend', (name: string) => buildJob.suspendUser({ username: name })],
    ['resume', (name: string) => buildJob.resumeUser({ username: name })],
    ['delete', (name: string) => buildJob.deleteUser({ username: name })],
  ] as const;

  for (const [action, build] of lifecycle) {
    server.post(`/admin/users/:name/${action}`, async (request, reply) => {
      const session = await guards.requireAdminCsrf(request, reply);
      if (session === undefined) {
        return;
      }
      const params = usernameParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send();
      }
      await deps.queue.enqueue(build(params.data.name));
      const target = action === 'delete' ? '/admin/users' : `/admin/users/${params.data.name}`;
      return redirectWithFlash(reply, target, `${ACTION_WORDS[action]} ${params.data.name}.`);
    });
  }

  // An unchecked HTML checkbox sends nothing at all, so presence is the value.
  const checkboxSchema = z.object({ allowed: z.literal('on').optional() });

  server.post('/admin/users/:name/public-trackers', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    const parsed = checkboxSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send();
    }
    const allowed = parsed.data.allowed === 'on';
    await deps.queue.enqueue(
      buildJob.setAllowPublicTracker({ username: params.data.name, allowed }),
    );
    return redirectWithFlash(
      reply,
      `/admin/users/${params.data.name}`,
      allowed
        ? `${params.data.name} may now add torrents from public trackers.`
        : `${params.data.name} is back to private trackers only.`,
    );
  });

  // Phrased positively for the operator ("run them") while the flag underneath
  // is negative ("disabled"). The inversion happens once, here.
  const runScriptsSchema = z.object({ run: z.literal('on').optional() });

  server.post('/admin/users/:name/finish-scripts', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    const parsed = runScriptsSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send();
    }
    const run = parsed.data.run === 'on';
    await deps.queue.enqueue(
      buildJob.setSyncDisabled({ username: params.data.name, disabled: !run }),
    );
    return redirectWithFlash(
      reply,
      `/admin/users/${params.data.name}`,
      run
        ? `${params.data.name}'s own scripts will run again after a download.`
        : `${params.data.name}'s own scripts will no longer run after a download.`,
    );
  });

  server.post('/admin/users/:name/password', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    const parsed = passwordSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send();
    }
    const job = await buildJob.changePassword(
      { username: params.data.name },
      Password.parse(parsed.data.password),
      deps.hasher,
    );
    await deps.queue.enqueue(job);
    return redirectWithFlash(
      reply,
      `/admin/users/${params.data.name}`,
      'Password change under way, it takes a few seconds.',
    );
  });
}
