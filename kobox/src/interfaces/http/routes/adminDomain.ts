import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SiteSettingsRepository } from '../../../domain/installation/ports.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import { adminDomainPage } from '../views/adminDomainPage.js';

// A hostname, not a URL: no scheme, no path, no trailing dot. Pasting the
// browser's address bar in here is the mistake this shape catches.
const LABEL = '[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
const domainSchema = z.object({
  domain: z.string().regex(new RegExp(`^${LABEL}(\\.${LABEL})+$`)).max(253),
  email: z.email(),
});

export interface AdminDomainDeps {
  readonly siteSettings: SiteSettingsRepository;
}

export function registerAdminDomainRoutes(
  server: FastifyInstance,
  deps: AdminDomainDeps,
  guards: Guards,
): void {
  server.get('/admin/domain', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    return reply
      .type('text/html')
      .send(adminDomainPage(await deps.siteSettings.get(), viewerOf(session), flashOf(request)));
  });

  server.post('/admin/domain', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = domainSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .type('text/html')
        .send(
          adminDomainPage(
            await deps.siteSettings.get(),
            viewerOf(session),
            undefined,
            'That is not a hostname. Give the name on its own, with no https:// and no trailing slash.',
          ),
        );
    }
    await deps.siteSettings.save({ domain: parsed.data.domain, email: parsed.data.email });
    return redirectWithFlash(
      reply,
      '/admin/domain',
      'Saved. Run kobox install on the box to request the certificate.',
    );
  });
}
