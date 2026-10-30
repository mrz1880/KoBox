#!/usr/bin/env node
import { Authenticate } from '../../application/portal/Authenticate.js';
import { Login } from '../../application/portal/Login.js';
import { Logout } from '../../application/portal/Logout.js';
import { CryptoSessionTokens } from '../../infrastructure/system/CryptoSessionTokens.js';
import { FsVpnProfileStore } from '../../infrastructure/system/FsVpnProfileStore.js';
import { buildPortalContainer, nowStamp } from '../composition.js';
import { buildPortalServer } from './server.js';
import { CryptoTotp } from '../../infrastructure/system/CryptoTotp.js';
import { EnterTwoStepCode } from '../../application/portal/EnterTwoStepCode.js';
import { TwoStepSetup } from '../../application/portal/TwoStepSetup.js';

export const DEFAULT_PORTAL_HTTP_PORT = 8190;


// The portal process: non-root, no privileged adapters in reach — it reads
// repositories and enqueues typed jobs, nothing else.
async function main(): Promise<void> {
  // the portal's own wiring: no JobWorker, no privileged adapter is even built
  const container = buildPortalContainer('kobox-portal');
  const tokens = new CryptoSessionTokens();
  const authDeps = {
    users: container.repo,
    credentials: container.credentials,
    sessions: container.sessions,
    attempts: container.loginAttempts,
    tokens,
    hasher: container.hasher,
    totp: new CryptoTotp(),
  };
  const server = buildPortalServer({
    login: new Login(authDeps),
    logout: new Logout(authDeps),
    authenticate: new Authenticate(authDeps),
    enterTwoStepCode: new EnterTwoStepCode(authDeps),
    twoStepSetup: new TwoStepSetup(authDeps),
    nowMs: () => Date.now(),
    authenticateApp: container.authenticateApp,
    issueAppToken: container.issueAppToken,
    now: nowStamp,
    logger: container.logger,
    users: container.repo,
    queue: container.queue,
    hasher: container.hasher,
    passwords: container.passwords,
    inviteMember: container.inviteMember,
    sendPasswordLink: container.sendPasswordLink,
    requestPasswordReset: container.requestPasswordReset,
    setPasswordFromLink: container.setPasswordFromLink,
    trackers: container.trackerRepo,
    blocklists: container.blocklistRepo,
    addresses: container.addressRepo,
    bindings: container.addressRepo,
    fairUse: container.fairUseRepo,
    health: container.healthProbe,
    components: container.componentRegistry,
    speedtests: container.speedtests,
    diagnostics: container.diagnostics,
    configFiles: container.configFiles,
    instances: container.instances,
    diskSamples: container.diskSamples,
    volumeSamples: container.volumeSamples,
    mailRelay: container.mailRelay,
    boxInVpn: container.boxInVpn,
    sshPort: container.sshPort,
    nextcloudSignsInFromPortal: container.nextcloudSignsInFromPortal,
    siteSettings: container.siteSettings,
    saveMailRelay: container.saveMailRelay,
    sshKeys: container.sshKeys,
    destinations: container.destinations,
    transfers: container.transfers,
    setDestination: container.setDestination,
    releases: container.releaseRepo,
    outbox: container.outbox,
    credentials: container.credentials,
    profiles: new FsVpnProfileStore(process.env.KOBOX_VPN_PROFILES_DIR),
    media: container.media,
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
