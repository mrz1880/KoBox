import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { PortalCredentials, PortalCredentialsPort } from '../../../domain/portal/ports.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import { ROLES } from '../../../domain/portal/Role.js';
import { USERNAME_PATTERN } from '../../../domain/user/Username.js';
import { Username } from '../../../domain/user/Username.js';
import type { TorrentInstanceRepository } from '../../../domain/torrent/ports.js';
import type {
  DiskUsageRepository,
  UserRepository,
  VolumeSampleRepository,
} from '../../../domain/user/ports.js';
import {
  MemberSuspendedError,
  TooManyPasswordLinksError,
  type InviteMember,
  type SendPasswordLink,
} from '../../../application/portal/PasswordLinks.js';
import { UserAlreadyExistsError } from '../../../application/user/errors.js';
import { EmailAddress } from '../../../domain/user/EmailAddress.js';
import { Quota } from '../../../domain/user/Quota.js';
import { buildJob } from '../../cli/buildJob.js';
import { invitationLinkPage } from '../views/passwordLinkPages.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import { adminUserDetailPage, adminUsersPage, type MemberLogin } from '../views/adminUsersPage.js';

const createUserSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN),
  email: z.email(),
  quotaGib: z.coerce.number().int().positive(),
  role: z.enum(ROLES),
});

const usernameParamSchema = z.object({ name: z.string().regex(USERNAME_PATTERN) });

export interface AdminUsersDeps {
  readonly users: UserRepository;
  readonly queue: JobQueuePort;
  readonly inviteMember: InviteMember;
  readonly sendPasswordLink: SendPasswordLink;
  readonly instances: TorrentInstanceRepository;
  readonly diskSamples: DiskUsageRepository;
  readonly volumeSamples: VolumeSampleRepository;
  readonly credentials: PortalCredentialsPort;
}

// Every mutation is an enqueue of the same typed jobs the CLI produces; the
// portal holds no privileged port.
// What each action is called from the operator's side, rather than the job type
// name that happens to implement it.
const ACTION_WORDS: Readonly<Record<'delete' | 'suspend' | 'resume', string>> = {
  delete: 'Deleting {name}.',
  suspend: 'Suspending {name}.',
  resume: 'Restoring {name}.',
};

// A login with no password yet: they have not followed their invitation.
function awaitsInvitation(login: PortalCredentials | undefined): boolean {
  return login !== undefined && login.passwordHash === undefined;
}

export function registerAdminUserRoutes(
  server: FastifyInstance,
  deps: AdminUsersDeps,
  guards: Guards,
): void {
  // each member's portal login as the list shows it: their role, and whether
  // they still have to follow their invitation (a login, no password)
  const loginsOf = async (
    users: readonly SeedboxUser[],
  ): Promise<ReadonlyMap<string, MemberLogin>> => {
    const logins = new Map<string, MemberLogin>();
    for (const user of users) {
      const login = await deps.credentials.find(user.username);
      if (login !== undefined) {
        logins.set(user.username.value, { role: login.role, invited: awaitsInvitation(login) });
      }
    }
    return logins;
  };

  server.get('/admin/users', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const users = await deps.users.listAll();
    return reply
      .type('text/html')
      .send(
        adminUsersPage(users, await loginsOf(users), viewerOf(session, request), flashOf(request)),
      );
  });

  server.post('/admin/users', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      const users = await deps.users.listAll();
      return reply
        .code(400)
        .type('text/html')
        .send(adminUsersPage(users, await loginsOf(users), viewerOf(session, request), undefined));
    }
    // nobody types the member's password: they choose it through the link
    let invitation: { readonly url: string };
    try {
      invitation = await deps.inviteMember.execute({
        username: Username.parse(parsed.data.username),
        email: EmailAddress.parse(parsed.data.email),
        quota: Quota.gib(parsed.data.quotaGib),
        role: parsed.data.role,
      });
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        return redirectWithFlash(
          reply,
          '/admin/users',
          viewerOf(session, request).t('{name} already exists.', { name: parsed.data.username }),
        );
      }
      throw error;
    }
    return reply
      .type('text/html')
      .send(invitationLinkPage(parsed.data.username, invitation.url, viewerOf(session, request)));
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
    const usage = await deps.diskSamples.find(user.username);
    const login = await deps.credentials.find(user.username);
    const access = awaitsInvitation(login) ? 'invited' : 'active';
    return reply
      .type('text/html')
      .send(
        adminUserDetailPage(
          user,
          viewerOf(session, request),
          login?.role,
          access,
          instance,
          usage,
          await deps.volumeSamples.find(),
          flashOf(request),
        ),
      );
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
      return redirectWithFlash(
        reply,
        target,
        viewerOf(session, request).t(ACTION_WORDS[action], { name: params.data.name }),
      );
    });
  }

  const quotaSchema = z.object({ quotaGib: z.coerce.number().int().positive() });

  server.post('/admin/users/:name/quota', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    const parsed = quotaSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send();
    }
    await deps.queue.enqueue(
      buildJob.setUserQuota({ username: params.data.name, quotaGib: parsed.data.quotaGib }),
    );
    return redirectWithFlash(
      reply,
      `/admin/users/${params.data.name}`,
      viewerOf(session, request).t('{name} now has {gib} GiB. Nobody else is affected.', {
        name: params.data.name,
        gib: String(parsed.data.quotaGib),
      }),
    );
  });

  const roleSchema = z.object({ role: z.enum(ROLES) });

  server.post('/admin/users/:name/role', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    const parsed = roleSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send();
    }
    await deps.queue.enqueue(
      buildJob.setUserRole({ username: params.data.name, role: parsed.data.role }),
    );
    return redirectWithFlash(
      reply,
      `/admin/users/${params.data.name}`,
      viewerOf(session, request).t('{name} is now {role} on the portal.', {
        name: params.data.name,
        role: parsed.data.role,
      }),
    );
  });

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
      viewerOf(session, request).t(
        allowed
          ? '{name} may now add torrents from public trackers.'
          : '{name} is back to private trackers only.',
        { name: params.data.name },
      ),
    );
  });

  const recyclingSchema = z.object({ mode: z.enum(['none', 'copy', 'hardlink']) });

  server.post('/admin/users/:name/recycling', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    const parsed = recyclingSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send();
    }
    await deps.queue.enqueue(
      buildJob.setRecycling({ username: params.data.name, mode: parsed.data.mode }),
    );
    return redirectWithFlash(
      reply,
      `/admin/users/${params.data.name}`,
      'Saved. It applies to what they add from now on, and changes nothing already on disk.',
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
      viewerOf(session, request).t(
        run
          ? "{name}'s own scripts will run again after a download."
          : "{name}'s own scripts will no longer run after a download.",
        { name: params.data.name },
      ),
    );
  });

  // An invitation again for a member who never chose a password (its link is
  // shown, to pass on another way), a reset for one who did (mailed only).
  server.post('/admin/users/:name/password-link', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const params = usernameParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send();
    }
    const target = `/admin/users/${params.data.name}`;
    let sent: { readonly url?: string };
    try {
      sent = await deps.sendPasswordLink.execute(Username.parse(params.data.name));
    } catch (error) {
      if (error instanceof TooManyPasswordLinksError || error instanceof MemberSuspendedError) {
        return redirectWithFlash(reply, target, error.message);
      }
      throw error;
    }
    if (sent.url === undefined) {
      return redirectWithFlash(
        reply,
        target,
        viewerOf(session, request).t('A reset link is on its way to {name}.', {
          name: params.data.name,
        }),
      );
    }
    return reply
      .type('text/html')
      .send(invitationLinkPage(params.data.name, sent.url, viewerOf(session, request)));
  });
}
