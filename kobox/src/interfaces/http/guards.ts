import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Authenticate, AuthenticatedSession } from '../../application/portal/Authenticate.js';
import { browserLanguage } from './browserLanguage.js';
import { html } from './html.js';
import { page, type Reader, type Viewer } from './views/layout.js';
import { translatorFor } from './views/messages.js';
import { secondStepRequired } from '../../domain/portal/policy.js';
import type { AwaitJob } from '../../application/jobs/AwaitJob.js';
import type { JobProgressPort, JobState } from '../../application/jobs/JobProgressPort.js';

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

// The members live by the box's clock, the zone its host is set to.
function boxZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Before sign-in there is no member to ask: the browser alone decides.
export function readerOf(request: FastifyRequest): Reader {
  const language = browserLanguage(request.headers['accept-language']);
  return { language, t: translatorFor(language), zone: boxZone() };
}

// The member's stored choice first; a member who never chose reads the portal
// in their browser's language.
export function viewerOf(session: AuthenticatedSession, request: FastifyRequest): Viewer {
  const language = session.chosenLanguage ?? browserLanguage(request.headers['accept-language']);
  return {
    username: session.username.value,
    role: session.role,
    csrfToken: session.csrfToken,
    language,
    t: translatorFor(language),
    zone: boxZone(),
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

  // Read in the member's language, but as a reader, not a viewer: the refusal
  // page offers no menu into what was just refused.
  const forbid = async (
    session: AuthenticatedSession,
    request: FastifyRequest,
    reply: FastifyReply,
    message: string,
  ): Promise<undefined> => {
    const { language, t, zone } = viewerOf(session, request);
    await reply
      .code(403)
      .type('text/html')
      .send(page('Forbidden', html`<h1>${t('Forbidden')}</h1><p>${t(message)}</p>`, { language, t, zone }));
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
      return forbid(session, request, reply, 'Invalid or missing CSRF token.');
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
      return forbid(session, request, reply, 'This area requires the admin role.');
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
      return forbid(session, request, reply, 'This area requires the admin role.');
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

// A change still on its way to the worker, or one it gave up on, outranks the
// message written for when it is done: that one would be a promise.
const IN_PROGRESS = 'Saving your change. This page refreshes by itself until it is done.';
const GAVE_UP = 'This change could not be applied. An administrator can find why under Troubleshooting.';
// a page waiting on the worker asks the browser to come back this often
const REFRESH_SECONDS = 2;

const jobStates = new WeakMap<FastifyRequest, JobState>();

function isUnderWay(state: JobState | undefined): boolean {
  return state === 'pending' || state === 'running';
}

// Hands the change to the worker and holds the answer a moment, so the next
// page shows it applied. A job still under way, or failed, travels in the
// address: the page it lands on keeps an eye on it.
export async function redirectOnceApplied(
  reply: FastifyReply,
  awaitJob: AwaitJob,
  job: number,
  to: string,
  message: string,
): Promise<void> {
  const state = await awaitJob.execute(job);
  const watched = isUnderWay(state) || state === 'failed' ? `&job=${String(job)}` : '';
  await reply
    .code(303)
    .header('location', `${to}?flash=${encodeURIComponent(message)}${watched}`)
    .send();
}

const watchedJobSchema = z.object({ job: z.coerce.number().int().positive() });

// Looks up the job a page was sent to watch, before the page is drawn.
export async function watchJob(
  request: FastifyRequest,
  reply: FastifyReply,
  progress: JobProgressPort,
): Promise<void> {
  const watched = watchedJobSchema.safeParse(request.query);
  if (!watched.success) {
    return;
  }
  const state = await progress.stateOf(watched.data.job);
  if (state === undefined) {
    return;
  }
  jobStates.set(request, state);
  if (isUnderWay(state)) {
    reply.header('refresh', String(REFRESH_SECONDS));
  }
}

export function flashOf(request: FastifyRequest): string | undefined {
  const state = jobStates.get(request);
  if (isUnderWay(state)) {
    return IN_PROGRESS;
  }
  if (state === 'failed') {
    return GAVE_UP;
  }
  const query = request.query as Record<string, unknown>;
  const value = query.flash;
  return typeof value === 'string' && value.length <= 200 ? value : undefined;
}
