import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authenticate, AuthenticatedSession } from '../../application/portal/Authenticate.js';
import { html } from './html.js';
import { page, type Viewer } from './views/layout.js';
import { translatorFor } from './views/messages.js';
import { secondStepRequired } from '../../domain/portal/policy.js';

export const SESSION_COOKIE = 'kobox_session';

const csrfFormSchema = z.looseObject({ _csrf: z.string().min(1) });

const TWO_STEP_FIRST = 'Set up two-step sign-in to open Administration.';

export interface Guards {
  sessionOf(request: FastifyRequest): Promise<AuthenticatedSession | undefined>;
  // a session that proved its password and waits for its two-step code
  pendingSessionOf(request: FastifyRequest): Promise<AuthenticatedSession | undefined>;
  requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined>;
  requireCsrf(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined>;
  requireAdmin(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined>;
  requireAdminCsrf(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined>;
}

// The two routes a forced-reset user may still reach: the change form and
// logout. Everything else redirects them to /password.
function isPasswordSelfService(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return path === '/password' || path === '/logout';
}

export function viewerOf(session: AuthenticatedSession): Viewer {
  return {
    username: session.username.value,
    role: session.role,
    csrfToken: session.csrfToken,
    language: session.language,
    t: translatorFor(session.language),
  };
}

export function buildGuards(authenticate: Authenticate, now: () => string): Guards {
  // any session the cookie names, a half-open one included
  const anySessionOf = async (
    request: FastifyRequest,
  ): Promise<AuthenticatedSession | undefined> => {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined || token === '') {
      return undefined;
    }
    return authenticate.execute({ token, now: now() });
  };

  // A session still waiting for its two-step code is no session: nginx asks
  // here for ruTorrent and Nextcloud, and the answer must be no.
  const sessionOf = async (
    request: FastifyRequest,
  ): Promise<AuthenticatedSession | undefined> => {
    const session = await anySessionOf(request);
    return session?.awaitingCode === true ? undefined : session;
  };

  const pendingSessionOf = async (
    request: FastifyRequest,
  ): Promise<AuthenticatedSession | undefined> => {
    const session = await anySessionOf(request);
    return session?.awaitingCode === true ? session : undefined;
  };

  const requireSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined> => {
    const session = await anySessionOf(request);
    if (session === undefined) {
      await reply.code(303).header('location', '/login').send();
      return undefined;
    }
    if (session.awaitingCode) {
      await reply.code(303).header('location', '/login/code').send();
      return undefined;
    }
    // A migrated user on a temporary password is funnelled to /password before
    // any other page (the change form and logout stay reachable).
    if (session.mustChangePassword && !isPasswordSelfService(request.url)) {
      await reply.code(303).header('location', '/password').send();
      return undefined;
    }
    return session;
  };

  const forbid = async (reply: FastifyReply, message: string): Promise<undefined> => {
    await reply
      .code(403)
      .type('text/html')
      .send(page('Forbidden', html`<h1>Forbidden</h1><p>${message}</p>`));
    return undefined;
  };

  const requireCsrf = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined> => {
    const session = await requireSession(request, reply);
    if (session === undefined) {
      return undefined;
    }
    const parsed = csrfFormSchema.safeParse(request.body);
    if (!parsed.success || parsed.data._csrf !== session.csrfToken) {
      return forbid(reply, 'Invalid or missing CSRF token.');
    }
    return session;
  };

  // An admin account opens every member's settings: Administration takes
  // two-step sign-in, and an admin without it is sent to set it up.
  const requireTwoStep = async (
    session: AuthenticatedSession,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined> => {
    if (secondStepRequired(session.role) && !session.hasTwoStep) {
      await reply
        .code(303)
        .header('location', `/access?flash=${encodeURIComponent(TWO_STEP_FIRST)}#two-step`)
        .send();
      return undefined;
    }
    return session;
  };

  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined> => {
    const session = await requireSession(request, reply);
    if (session === undefined) {
      return undefined;
    }
    if (session.role !== 'admin') {
      return forbid(reply, 'This area requires the admin role.');
    }
    return requireTwoStep(session, reply);
  };

  const requireAdminCsrf = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | undefined> => {
    const session = await requireCsrf(request, reply);
    if (session === undefined) {
      return undefined;
    }
    if (session.role !== 'admin') {
      return forbid(reply, 'This area requires the admin role.');
    }
    return requireTwoStep(session, reply);
  };

  return { sessionOf, pendingSessionOf, requireSession, requireCsrf, requireAdmin, requireAdminCsrf };
}

// Post/redirect/get with a flash message carried in the query string (the
// message is a fixed server-side string, never user input echoed back).
export async function redirectWithFlash(
  reply: FastifyReply,
  to: string,
  message: string,
): Promise<void> {
  await reply
    .code(303)
    .header('location', `${to}?flash=${encodeURIComponent(message)}`)
    .send();
}

export function flashOf(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, unknown>;
  const value = query.flash;
  return typeof value === 'string' && value.length <= 200 ? value : undefined;
}
