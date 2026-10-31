import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AwaitJob } from '../../../application/jobs/AwaitJob.js';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import { DynDnsHost } from '../../../domain/security/DynDnsHost.js';
import type { DynDnsBindingRepository, FairUseRepository } from '../../../domain/security/ports.js';
import { IPV4_PATTERN, IpAddress } from '../../../domain/shared/IpAddress.js';
import type { UserAddressRepository } from '../../../domain/tracker/ports.js';
import { USERNAME_PATTERN } from '../../../domain/user/Username.js';
import type { UserRepository } from '../../../domain/user/ports.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards, redirectOnceApplied } from '../guards.js';
import {
  adminAddressesPage,
  adminFairUsePage,
  type FairUseRow,
} from '../views/adminNetworkPage.js';

const usernameField = z.string().regex(USERNAME_PATTERN);

const addressSchema = z.object({
  username: usernameField,
  ipv4: z.string().regex(IPV4_PATTERN),
});

const hostnameSchema = z.object({
  username: usernameField,
  hostname: z
    .string()
    .max(253)
    .refine((raw) => {
      try {
        DynDnsHost.parse(raw);
        return true;
      } catch {
        return false;
      }
    }),
});

// "" = keep, "clear" = reset to default (null on the wire), number = Mbit/s.
const overrideField = z
  .string()
  .transform((raw) => raw.trim())
  .refine((raw) => raw === '' || /^[1-9]\d{0,5}$/.test(raw));
// a ticked "back to the default" box
const defaultBox = z.literal('on').optional();

const overrideSchema = z.object({
  username: usernameField,
  egressLimitMbit: overrideField,
  egressLimitMbitDefault: defaultBox,
  authRatePerHour: overrideField,
  authRatePerHourDefault: defaultBox,
  throttleToMbit: overrideField,
  throttleToMbitDefault: defaultBox,
});

// One limit as the form gives it: back to the default when its box is ticked
// (null), left alone when empty (undefined), else the number typed.
function toOverride(raw: string, backToDefault: 'on' | undefined): number | null | undefined {
  if (backToDefault === 'on') {
    return null;
  }
  return raw === '' ? undefined : Number(raw);
}

function mbitToBps(override: number | null | undefined): number | null | undefined {
  return typeof override === 'number' ? override * 1_000_000 : override;
}

export interface AdminNetworkDeps {
  readonly users: UserRepository;
  readonly addresses: UserAddressRepository;
  readonly bindings: DynDnsBindingRepository;
  readonly fairUse: FairUseRepository;
  readonly queue: JobQueuePort;
  readonly awaitJob: AwaitJob;
}

export function registerAdminNetworkRoutes(
  server: FastifyInstance,
  deps: AdminNetworkDeps,
  guards: Guards,
): void {
  server.get('/admin/addresses', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const [addresses, hostnames] = await Promise.all([
      deps.addresses.listAll(),
      deps.bindings.listHostnames(),
    ]);
    return reply
      .type('text/html')
      .send(adminAddressesPage(addresses, hostnames, viewerOf(session, request), flashOf(request)));
  });

  const addressActions = [
    ['add', (input: { username: string; ipv4: string }) => buildJob.addUserAddress(input)],
    ['remove', (input: { username: string; ipv4: string }) => buildJob.removeUserAddress(input)],
  ] as const;

  for (const [action, build] of addressActions) {
    server.post(`/admin/addresses/${action}`, async (request, reply) => {
      const session = await guards.requireAdminCsrf(request, reply);
      if (session === undefined) {
        return;
      }
      const parsed = addressSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send();
      }
      // removal stays open to any address, so one added before this check goes
      if (action === 'add' && !IpAddress.parse(parsed.data.ipv4).isPublic) {
        return redirectWithFlash(
          reply,
          '/admin/addresses',
          viewerOf(session, request).t(
            '{address} is a private address: no connection from the internet comes from it.',
            { address: parsed.data.ipv4 },
          ),
        );
      }
      const job = await deps.queue.enqueue(build(parsed.data));
      return redirectOnceApplied(reply, deps.awaitJob, job,
        '/admin/addresses',
        action === 'add' ? 'Adding the address.' : 'Removing the address.',
      );
    });
  }

  const hostnameActions = [
    ['add-hostname', (input: { username: string; hostname: string }) => buildJob.addUserHostname(input)],
    [
      'remove-hostname',
      (input: { username: string; hostname: string }) => buildJob.removeUserHostname(input),
    ],
  ] as const;

  for (const [action, build] of hostnameActions) {
    server.post(`/admin/addresses/${action}`, async (request, reply) => {
      const session = await guards.requireAdminCsrf(request, reply);
      if (session === undefined) {
        return;
      }
      const parsed = hostnameSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send();
      }
      const job = await deps.queue.enqueue(build(parsed.data));
      return redirectOnceApplied(reply, deps.awaitJob, job,
        '/admin/addresses',
        action === 'add-hostname' ? 'Adding the hostname.' : 'Removing the hostname.',
      );
    });
  }

  server.get('/admin/fair-use', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const rows: FairUseRow[] = [];
    for (const user of await deps.users.listAll()) {
      const state = await deps.fairUse.getState(user.username);
      const sample = await deps.fairUse.lastSample(user.username);
      const events = await deps.fairUse.listEvents(user.username);
      rows.push({
        username: user.username.value,
        level: state.level,
        health: state.healthState,
        ...(sample !== undefined && { sample }),
        events,
      });
    }
    return reply
      .type('text/html')
      .send(adminFairUsePage(rows, viewerOf(session, request), flashOf(request)));
  });

  server.post('/admin/fair-use/override', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = overrideSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    const egressLimitBps = mbitToBps(
      toOverride(parsed.data.egressLimitMbit, parsed.data.egressLimitMbitDefault),
    );
    const authRatePerHour = toOverride(parsed.data.authRatePerHour, parsed.data.authRatePerHourDefault);
    const throttleToBps = mbitToBps(
      toOverride(parsed.data.throttleToMbit, parsed.data.throttleToMbitDefault),
    );
    const job = await deps.queue.enqueue(
      buildJob.setFairUseOverride({
        username: parsed.data.username,
        ...(egressLimitBps !== undefined && { egressLimitBps }),
        ...(authRatePerHour !== undefined && { authRatePerHour }),
        ...(throttleToBps !== undefined && { throttleToBps }),
      }),
    );
    return redirectOnceApplied(reply, deps.awaitJob, job, '/admin/fair-use', 'Override applied.');
  });
}
