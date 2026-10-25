import type { FastifyInstance } from 'fastify';
import { viewerOf, type Guards } from '../guards.js';
import { adminGroupPage } from '../views/adminGroupPage.js';
import { ADMIN_GROUPS } from '../views/adminGroups.js';

export function registerAdminGroupRoutes(server: FastifyInstance, guards: Guards): void {
  for (const group of ADMIN_GROUPS) {
    server.get(group.path, async (request, reply) => {
      const session = await guards.requireAdmin(request, reply);
      if (session === undefined) {
        return;
      }
      return reply.type('text/html').send(adminGroupPage(group, viewerOf(session)));
    });
  }
}
