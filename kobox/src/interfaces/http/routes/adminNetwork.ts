import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import { DynDnsHost } from '../../../domain/security/DynDnsHost.js';
import type { DynDnsBindingRepository, FairUseRepository } from '../../../domain/security/ports.js';
import { IPV4_PATTERN } from '../../../domain/shared/IpAddress.js';
import type { UserAddressRepository } from '../../../domain/tracker/ports.js';
import { USERNAME_PATTERN } from '../../../domain/user/Username.js';
import type { UserRepository } from '../../../domain/user/ports.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
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
  .refine((raw) => raw === '' || raw === 'clear' || /^[1-9]\d{0,5}$/.test(raw));

const overrideSchema = z.object({
  username: usernameField,
  egressLimitMbit: overrideField,
  authRatePerHour: overrideField,
  throttleToMbit: overrideField,
});

function toBpsOverride(raw: string): number | null | undefined {
  if (raw === '') {
    return undefined;
  }
  return raw === 'clear' ? null : Number(raw) * 1_000_000;
}

function toCountOverride(raw: string): number | null | undefined {
  if (raw === '') {
    return undefined;
  }
  return raw === 'clear' ? null : Number(raw);
}

export interface AdminNetworkDeps {
  readonly users: UserRepository;
  readonly addresses: UserAddressRepository;
  readonly bindings: DynDnsBindingRepository;
  readonly fairUse: FairUseRepository;
  readonly queue: JobQueuePort;
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
      .send(adminAddressesPage(addresses, hostnames, viewerOf(session), flashOf(request)));
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
      await deps.queue.enqueue(build(parsed.data));
      return redirectWithFlash(reply, '/admin/addresses', `${action} address queued`);
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
      await deps.queue.enqueue(build(parsed.data));
      return redirectWithFlash(reply, '/admin/addresses', `${action} queued`);
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
      .send(adminFairUsePage(rows, viewerOf(session), flashOf(request)));
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
    const egressLimitBps = toBpsOverride(parsed.data.egressLimitMbit);
    const authRatePerHour = toCountOverride(parsed.data.authRatePerHour);
    const throttleToBps = toBpsOverride(parsed.data.throttleToMbit);
    await deps.queue.enqueue(
      buildJob.setFairUseOverride({
        username: parsed.data.username,
        ...(egressLimitBps !== undefined && { egressLimitBps }),
        ...(authRatePerHour !== undefined && { authRatePerHour }),
        ...(throttleToBps !== undefined && { throttleToBps }),
      }),
    );
    return redirectWithFlash(reply, '/admin/fair-use', 'override queued');
  });
}
