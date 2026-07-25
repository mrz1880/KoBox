#!/usr/bin/env node
import { Authenticate } from '../../application/portal/Authenticate.js';
import { Login } from '../../application/portal/Login.js';
import { Logout } from '../../application/portal/Logout.js';
import { CryptoSessionTokens } from '../../infrastructure/system/CryptoSessionTokens.js';
import { buildContainer } from '../composition.js';
import { buildPortalServer } from './server.js';

export const DEFAULT_PORTAL_HTTP_PORT = 8190;

function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// The portal process: non-root, no privileged adapters in reach — it reads
// repositories and enqueues typed jobs, nothing else (AUDIT §3.5).
async function main(): Promise<void> {
  const container = buildContainer('kobox-portal');
  const tokens = new CryptoSessionTokens();
  const authDeps = {
    users: container.repo,
    credentials: container.credentials,
    sessions: container.sessions,
    attempts: container.loginAttempts,
    tokens,
    hasher: container.hasher,
  };
  const server = buildPortalServer({
    login: new Login(authDeps),
    logout: new Logout(authDeps),
    authenticate: new Authenticate(authDeps),
    now: nowStamp,
    logger: container.logger,
    users: container.repo,
    queue: container.queue,
    hasher: container.hasher,
    trackers: container.trackerRepo,
    blocklists: container.blocklistRepo,
    addresses: container.addressRepo,
    bindings: container.addressRepo,
    fairUse: container.fairUseRepo,
  });

  const port = Number(process.env.KOBOX_PORTAL_HTTP_PORT ?? DEFAULT_PORTAL_HTTP_PORT);
  const host = process.env.KOBOX_PORTAL_HTTP_HOST ?? '127.0.0.1';

  // hourly housekeeping: expired sessions leave the table
  const purge = (): void => {
    void container.sessions.purgeExpired(nowStamp()).catch(() => undefined);
  };
  purge();
  const timer = setInterval(purge, 60 * 60 * 1000);
  timer.unref();

  await server.listen({ port, host });
  container.logger.info({ port, host }, 'portal listening');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
