import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PasswordLinkUnusableError,
  type RequestPasswordReset,
  type SetPasswordFromLink,
} from '../../../application/portal/PasswordLinks.js';
import { passwordField } from '../passwordField.js';
import {
  choosePasswordPage,
  forgotPasswordPage,
  forgotPasswordSentPage,
  passwordChosenPage,
  passwordLinkClosedPage,
} from '../views/passwordLinkPages.js';

export interface PasswordLinkRouteDeps {
  readonly requestPasswordReset: RequestPasswordReset;
  readonly setPasswordFromLink: SetPasswordFromLink;
}

const tokenParams = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });
const forgotSchema = z.object({ identifier: z.string().min(1).max(254) });
const chooseSchema = z.object({ password: z.string().max(1024), confirm: z.string().max(1024) });

// Reached without a session: the member is locked out or not in yet. Nothing
// here says whether an account exists or why a link stopped working.
export function registerPasswordLinkRoutes(
  server: FastifyInstance,
  deps: PasswordLinkRouteDeps,
): void {
  server.get('/forgot-password', async (_request, reply) =>
    reply.type('text/html').send(forgotPasswordPage()),
  );

  server.post('/forgot-password', async (request, reply) => {
    const parsed = forgotSchema.safeParse(request.body);
    if (parsed.success) {
      await deps.requestPasswordReset.execute(parsed.data.identifier);
    }
    return reply.type('text/html').send(forgotPasswordSentPage());
  });

  server.get('/password-link/:token', async (request, reply) => {
    const params = tokenParams.safeParse(request.params);
    const open = params.success && (await deps.setPasswordFromLink.isOpen(params.data.token));
    return reply
      .type('text/html')
      .send(open ? choosePasswordPage(request.url) : passwordLinkClosedPage());
  });

  server.post('/password-link/:token', async (request, reply) => {
    const params = tokenParams.safeParse(request.params);
    if (!params.success) {
      return reply.type('text/html').send(passwordLinkClosedPage());
    }
    const form = chooseSchema.safeParse(request.body);
    if (!form.success) {
      return reply.type('text/html').send(choosePasswordPage(request.url, 'Please fill in both fields.'));
    }
    if (form.data.password !== form.data.confirm) {
      return reply.type('text/html').send(choosePasswordPage(request.url, 'The two passwords do not match.'));
    }
    const password = passwordField.safeParse(form.data.password);
    if (!password.success) {
      const reason = password.error.issues[0]?.message ?? 'invalid password';
      return reply.type('text/html').send(choosePasswordPage(request.url, `Please choose another password: ${reason}.`));
    }
    try {
      await deps.setPasswordFromLink.execute({ token: params.data.token, password: password.data });
    } catch (error) {
      if (error instanceof PasswordLinkUnusableError) {
        return reply.type('text/html').send(passwordLinkClosedPage());
      }
      throw error;
    }
    return reply.type('text/html').send(passwordChosenPage());
  });
}
