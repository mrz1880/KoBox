import type { ComponentNameValue } from '../../domain/installation/ComponentName.js';
import type {
  ArtifactFetchPort,
  ConfigCheckPort,
  ConfigCheckResult,
  InstallHostPort,
  PackagePort,
  SystemFacts,
  SystemdPort,
} from '../../domain/installation/ports.js';
import type { CertbotPort } from '../maintenance/CertbotPort.js';
import {
  ACME_WEBROOT,
  renderAptSources,
  renderBindLocal,
  renderCertbotDeployHook,
  renderBindOptions,
  renderDnscryptConfig,
  renderFirewallBootUnit,
  renderNginxVhost,
  renderAria2Conf,
  renderAria2Unit,
  renderNanomonUnit,
  renderPortalEnv,
  renderPortalUnit,
  renderRutorrentConfig,
  renderShellinaboxDefault,
  renderSmbConf,
  renderSshdDropin,
  renderSysctlTweaks,
  renderWorkerEnv,
  renderWorkerUnit,
  type NginxVhostSettings,
} from '../../domain/installation/rendering.js';
import { renderCronFile } from '../../domain/maintenance/rendering.js';
import type { DebridKeyPairPort } from '../../domain/ddl/ports.js';
import type { IpsetPort } from '../../domain/tracker/ports.js';
import type { VpnPkiPort, VpnPkiProvisionPort } from '../../domain/security/ports.js';
import { PORTAL_GROUP, VPN_VARIANTS, renderOpenVpnServer } from '../../domain/security/vpn.js';
import type { ManagedFilesPort, RenderedFile } from '../../domain/shared/files.js';
import type { SecuritySettings } from '../security/settings.js';

export interface InstallSettings {
  readonly nodeBin: string;
  // the running source tree (linked as `current` on first install) and the
  // symlink the worker unit executes through — upgrades flip the link only
  readonly sourceDir: string;
  readonly currentLink: string;
  readonly koboxBin: string;
  readonly manageAptSources: boolean;
  // release pin for the vendored ruTorrent archive (env-driven: shipping a
  // baked sha for a moving upstream would be a lie) — unset = honest skip
  readonly rutorrentUrl?: string;
  readonly rutorrentSha256?: string;
  // release pin for the vendored NanoMon binary (env-driven, same rationale as
  // ruTorrent) — unset = honest skip
  readonly nanomonUrl?: string;
  readonly nanomonSha256?: string;
  // link measurement binary, pinned like the other vendored artifacts —
  // unset = the component honestly skips and the admin screen says so
  readonly speedtestUrl?: string;
  readonly speedtestSha256?: string;
  // DDL/debrid: the aria2 RPC secret (shared with the worker's Aria2Adapter);
  // unset = the download engine honestly skips. Staging dir aria2 writes into.
  readonly aria2RpcSecret?: string;
  readonly ddlStagingDir?: string;
  readonly quotaFs?: string;
  // env-driven: KOBOX_LE_DOMAIN/KOBOX_LE_EMAIL (+ KOBOX_ACME_URL for the
  // pebble fixture); unset = honest skip, snakeoil stays
  readonly letsencrypt?: {
    readonly domain: string;
    readonly email: string;
    readonly acmeUrl?: string;
  };
  readonly workerEnv: ReadonlyMap<string, string>;
}

export interface InstallerContext {
  readonly packages: PackagePort;
  readonly files: ManagedFilesPort;
  readonly systemd: SystemdPort;
  readonly checks: ConfigCheckPort;
  readonly host: InstallHostPort;
  readonly ipset: IpsetPort;
  readonly debridKeys: DebridKeyPairPort;
  readonly certbot: CertbotPort;
  readonly pki: VpnPkiPort;
  readonly pkiProvision: VpnPkiProvisionPort;
  readonly artifacts: ArtifactFetchPort;
  readonly facts: SystemFacts;
  readonly security: SecuritySettings;
  readonly install: InstallSettings;
}

export type InstallOutcome =
  | { readonly state: 'installed'; readonly version?: string; readonly detail?: string }
  | { readonly state: 'skipped'; readonly reason: string };

export interface ComponentInstaller {
  readonly name: ComponentNameValue;
  install(): Promise<InstallOutcome>;
  uninstall(): Promise<void>;
}

export class InstallGuardError extends Error {
  constructor(component: string, detail: string) {
    super(`${component}: config check failed, changes rolled back — ${detail}`);
    this.name = 'InstallGuardError';
  }
}

// The anti-brick primitive: render, validate with the service's own checker,
// and on failure restore what was there before (or remove what was not).
// Returns the changed paths so callers reload only when something moved.
async function guardedApply(
  ctx: InstallerContext,
  component: string,
  rendered: readonly RenderedFile[],
  check: () => Promise<ConfigCheckResult>,
): Promise<readonly string[]> {
  const priors = new Map<string, string | undefined>();
  for (const file of rendered) {
    priors.set(file.path, await ctx.host.readFile(file.path));
  }
  const changed = await ctx.files.apply(rendered);
  // a checker that DIES (spawn failure, timeout) rolls back exactly like a
  // checker that says no — an unvalidated render never stays on disk
  let result: ConfigCheckResult;
  try {
    result = await check();
  } catch (error) {
    await restorePriors(ctx, rendered, priors);
    throw error;
  }
  if (result.ok) {
    return changed;
  }
  await restorePriors(ctx, rendered, priors);
  throw new InstallGuardError(component, result.detail);
}

async function restorePriors(
  ctx: InstallerContext,
  rendered: readonly RenderedFile[],
  priors: ReadonlyMap<string, string | undefined>,
): Promise<void> {
  for (const file of rendered) {
    const prior = priors.get(file.path);
    if (prior === undefined) {
      await ctx.host.removeFile(file.path);
    } else {
      await ctx.files.apply([{ ...file, content: prior }]);
    }
  }
}

const WORKER_UNIT = '/etc/systemd/system/kobox-worker.service';
const FIREWALL_UNIT = '/etc/systemd/system/kobox-firewall.service';
const WORKER_ENV = '/etc/kobox/worker.env';
const PORTAL_ENV = '/etc/kobox/portal.env';
const SSHD_DROPIN = '/etc/ssh/sshd_config.d/90-kobox.conf';
const SYSCTL_DROPIN = '/etc/sysctl.d/90-kobox.conf';
const NGINX_VHOST = '/etc/nginx/conf.d/kobox.conf';
const HTPASSWD = '/etc/nginx/kobox.htpasswd';
const RUTORRENT_DIR = '/var/www/rutorrent';
const RUTORRENT_MARKER = `${RUTORRENT_DIR}/.kobox-artifact-sha256`;
const RUTORRENT_ARCHIVE = '/var/tmp/kobox/rutorrent.tar.gz';
const NANOMON_BIN = '/usr/local/bin/nanomon';
const NANOMON_MARKER = '/etc/kobox/nanomon.sha256';
const NANOMON_UNIT = '/etc/systemd/system/kobox-nanomon.service';
const SPEEDTEST_BIN = '/usr/local/bin/librespeed-cli';
const SPEEDTEST_MARKER = '/etc/kobox/speedtest.sha256';
const ZONES_SEED = '/etc/bind/kobox.zones.blacklists';
const CRON_FILE = '/etc/cron.d/kobox';
const BLOCKED_NAMES_SEED = '/etc/dnscrypt-proxy/blocked-names.txt';

function installed(version?: string, detail?: string): InstallOutcome {
  return {
    state: 'installed',
    ...(version !== undefined && { version }),
    ...(detail !== undefined && { detail }),
  };
}

class KoboxCoreInstaller implements ComponentInstaller {
  readonly name = 'kobox-core';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { host, files, systemd, install } = this.ctx;
    // the non-root identity the SSR portal runs under (Phase 6)
    await host.ensureServiceAccount(PORTAL_GROUP);
    await host.ensureDir('/etc/kobox', '0755');
    // the DB is shared: the root worker writes, the portal (kobox-portal group)
    // reads and writes sessions/credentials. 2770 + setgid keeps new WAL/-shm
    // files group-owned so both processes can open them.
    await host.ensureDir('/var/lib/kobox', '2770');
    await host.setOwnership('/var/lib/kobox', 'root', PORTAL_GROUP, '2770');
    await host.ensureDir('/var/spool/kobox/events', '1733');
    // first install: current -> the tree the installer runs from; upgrades
    // own the link afterwards (ensureSymlink never overwrites an existing one)
    await host.ensureSymlink(install.currentLink, install.sourceDir);
    // the pair that seals per-user debrid keys; idempotent, so re-installs and
    // upgrades never orphan a stored key
    await this.ctx.debridKeys.ensurePair();
    await files.apply([
      renderWorkerEnv(install.workerEnv),
      renderWorkerUnit({
        nodeBin: install.nodeBin,
        workerMain: `${install.currentLink}/dist/interfaces/worker/main.js`,
      }),
      renderFirewallBootUnit(),
    ]);
    await systemd.daemonReload();
    await systemd.enable('kobox-worker', { now: true });
    // enabled only: ConditionPathExists guards the pre-first-apply boot
    await systemd.enable('kobox-firewall');
    return installed();
  }

  async uninstall(): Promise<void> {
    const { host, systemd } = this.ctx;
    await systemd.disable('kobox-worker', { now: true });
    await systemd.disable('kobox-firewall', { now: true });
    for (const path of [WORKER_UNIT, FIREWALL_UNIT, WORKER_ENV]) {
      await host.removeFile(path);
    }
    // /var/lib/kobox (the database) and the spool are DATA — never removed
    await systemd.daemonReload();
  }
}

class AptSourcesInstaller implements ComponentInstaller {
  readonly name = 'apt-sources';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    if (!this.ctx.install.manageAptSources) {
      return { state: 'skipped', reason: 'operator-managed sources (--manage-apt-sources to opt in)' };
    }
    await this.ctx.files.apply([renderAptSources()]);
    await this.ctx.packages.refresh();
    return installed();
  }

  async uninstall(): Promise<void> {
    // sources.list stays: removing the package index source would strand apt
  }
}

class SshdInstaller implements ComponentInstaller {
  readonly name = 'sshd';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, systemd, security, checks } = this.ctx;
    await packages.ensureInstalled(['openssh-server']);
    const changed = await guardedApply(
      this.ctx,
      this.name,
      [renderSshdDropin(security.sshPort)],
      () => checks.sshd(),
    );
    if (changed.length > 0) {
      await systemd.reloadOrRestart('ssh');
    }
    return installed(await packages.installedVersion('openssh-server'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.host.removeFile(SSHD_DROPIN);
    await this.ctx.systemd.reloadOrRestart('ssh');
  }
}

class TweaksInstaller implements ComponentInstaller {
  readonly name = 'tweaks';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    await this.ctx.files.apply([renderSysctlTweaks()]);
    await this.ctx.host.applySysctl();
    return installed();
  }

  async uninstall(): Promise<void> {
    await this.ctx.host.removeFile(SYSCTL_DROPIN);
    await this.ctx.host.applySysctl();
  }
}

class QuotaInstaller implements ComponentInstaller {
  readonly name = 'quota';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, install } = this.ctx;
    await packages.ensureInstalled(['quota']);
    const fs = install.quotaFs;
    if (fs === undefined) {
      return installed(undefined, 'tools installed; set KOBOX_QUOTA_FS to activate enforcement');
    }
    const options = await host.mountOptions(fs);
    if (!options.includes('usrquota')) {
      // never edit fstab automatically — brick territory; tell the operator
      return installed(
        undefined,
        `tools installed; add usrquota to the ${fs} mount options in /etc/fstab, remount, then re-run kobox install`,
      );
    }
    await host.activateQuota(fs);
    return installed(undefined, `hard quotas active on ${fs}`);
  }

  async uninstall(): Promise<void> {
    // quota tools and any active quota stay: turning quotas off is an
    // operator decision, not a side effect of uninstalling KoBox
  }
}

class NginxInstaller implements ComponentInstaller {
  readonly name = 'nginx';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, systemd, checks } = this.ctx;
    await packages.ensureInstalled(['nginx', 'php-fpm', 'ssl-cert']);
    // stock Debian ships sites-enabled/default with `listen 80
    // default_server`: while that symlink exists it swallows every HTTP-01
    // challenge (server_name _ never matches a Host) and Let's Encrypt can
    // never validate — remove it; sites-available/default stays untouched
    await host.removeFile('/etc/nginx/sites-enabled/default');
    // Phase 6: the shared Basic Auth is retired — the vhost authenticates via
    // the portal now. Drop any leftover htpasswd and hold the include dir the
    // per-user /RPC-<USER> mounts land in.
    await host.removeFile(HTPASSWD);
    await host.ensureDir('/etc/nginx/kobox.d', '0755');
    const changed = await guardedApply(
      this.ctx,
      this.name,
      [renderNginxVhost(await nginxVhostSettings(this.ctx))],
      () => checks.nginx(),
    );
    await systemd.enable('nginx', { now: true });
    if (changed.length > 0) {
      await systemd.reloadOrRestart('nginx');
    }
    return installed(await packages.installedVersion('nginx'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.host.removeFile(NGINX_VHOST);
    if (await this.ctx.systemd.isActive('nginx')) {
      await this.ctx.systemd.reloadOrRestart('nginx');
    }
  }
}

class RtorrentInstaller implements ComponentInstaller {
  readonly name = 'rtorrent';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    // Debian 12 ships rtorrent 0.9.8 — prod parity without build-from-source
    // (Annexe B #95: pinned packaging over fragile compilation)
    await this.ctx.packages.ensureInstalled(['rtorrent']);
    return installed(await this.ctx.packages.installedVersion('rtorrent'));
  }

  async uninstall(): Promise<void> {
    // per-user units are owned by deprovision-rtorrent; the package stays
  }
}

class RutorrentInstaller implements ComponentInstaller {
  readonly name = 'rutorrent';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, artifacts, files, install } = this.ctx;
    if (install.rutorrentUrl === undefined || install.rutorrentSha256 === undefined) {
      return {
        state: 'skipped',
        reason:
          'no ruTorrent release pinned — set KOBOX_RUTORRENT_URL and KOBOX_RUTORRENT_SHA256, then re-run kobox install',
      };
    }
    await packages.ensureInstalled(['php-fpm', 'php-cli', 'unzip']);
    const marker = await host.readFile(RUTORRENT_MARKER);
    if (marker?.trim() !== install.rutorrentSha256) {
      await artifacts.fetchVerified(install.rutorrentUrl, install.rutorrentSha256, RUTORRENT_ARCHIVE);
      await host.ensureDir(RUTORRENT_DIR, '0755');
      await host.extractTarGz(RUTORRENT_ARCHIVE, RUTORRENT_DIR);
      await files.apply([
        {
          path: RUTORRENT_MARKER,
          content: `${install.rutorrentSha256}\n`,
          mode: '0644',
          owner: 'root',
          group: 'root',
        },
      ]);
    }
    await files.apply([renderRutorrentConfig()]);
    return installed();
  }

  async uninstall(): Promise<void> {
    // the vendored tree stays (nothing references it once nginx drops the
    // vhost); removal is an operator decision
  }
}

class BindInstaller implements ComponentInstaller {
  readonly name = 'bind';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, systemd, checks } = this.ctx;
    await packages.ensureInstalled(['bind9', 'bind9utils']);
    // seed only: render-whitelist owns the real zone content
    await host.ensureFile({
      path: ZONES_SEED,
      content: '// rendered by kobox render-whitelist\n',
      mode: '0644',
      owner: 'root',
      group: 'bind',
    });
    // the dnscrypt component ran first (catalog dependency): forward to it
    // only when it actually landed
    const dnscryptForwarder = await packages.isInstalled('dnscrypt-proxy');
    const changed = await guardedApply(
      this.ctx,
      this.name,
      [renderBindLocal(), renderBindOptions({ dnscryptForwarder })],
      () => checks.bind(),
    );
    await systemd.enable('named', { now: true });
    if (changed.length > 0) {
      await systemd.reloadOrRestart('named');
    }
    return installed(await packages.installedVersion('bind9'));
  }

  async uninstall(): Promise<void> {
    // config files stay valid; the service simply stops being ours
    await this.ctx.systemd.disable('named', { now: true });
  }
}

class DnscryptInstaller implements ComponentInstaller {
  readonly name = 'dnscrypt';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, systemd, files } = this.ctx;
    if (!(await packages.isAvailable('dnscrypt-proxy'))) {
      // bookworm dropped dnscrypt-proxy (nor in backports); bind renders
      // direct recursion instead — DNS-privacy alternative is a Phase 5 call
      return {
        state: 'skipped',
        reason:
          'dnscrypt-proxy is not packaged for Debian 12 (bookworm, incl. backports); bind falls back to direct recursion — DNS-privacy alternative deferred to Phase 5',
      };
    }
    await packages.ensureInstalled(['dnscrypt-proxy']);
    // Debian socket-activation hijacks the listen address — the rendered
    // toml owns 127.0.0.1:52, so the socket unit must go
    await systemd.disable('dnscrypt-proxy.socket', { now: true });
    await host.ensureFile({
      path: BLOCKED_NAMES_SEED,
      content: '',
      mode: '0644',
      owner: 'root',
      group: 'root',
    });
    const changed = await files.apply([renderDnscryptConfig()]);
    await systemd.enable('dnscrypt-proxy', { now: true });
    if (changed.length > 0) {
      await systemd.reloadOrRestart('dnscrypt-proxy');
    }
    return installed(await packages.installedVersion('dnscrypt-proxy'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.systemd.disable('dnscrypt-proxy', { now: true });
  }
}

// Shared with NginxInstaller: once a live chain exists for the configured
// domain, EVERY vhost render uses it — a full re-install must never flap the
// portal back to snakeoil.
async function nginxVhostSettings(ctx: InstallerContext): Promise<NginxVhostSettings> {
  const le = ctx.install.letsencrypt;
  if (le && (await ctx.host.pathExists(`/etc/letsencrypt/live/${le.domain}/fullchain.pem`))) {
    return { portalPort: ctx.security.portalPort, letsencrypt: { domain: le.domain } };
  }
  return { portalPort: ctx.security.portalPort };
}

class LetsencryptInstaller implements ComponentInstaller {
  readonly name = 'letsencrypt';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, files, systemd, checks, certbot, install } = this.ctx;
    const le = install.letsencrypt;
    if (!le) {
      return {
        state: 'skipped',
        reason:
          'no public FQDN configured — set KOBOX_LE_DOMAIN and KOBOX_LE_EMAIL, then re-run kobox install (snakeoil certificate stays)',
      };
    }
    await packages.ensureInstalled(['certbot']);
    await host.ensureDir(ACME_WEBROOT, '0755');
    // the :80 ACME block is already part of the nginx vhost — certbot can
    // validate through the running server (webroot, no downtime)
    await certbot.obtain({
      domain: le.domain,
      email: le.email,
      webroot: ACME_WEBROOT,
      ...(le.acmeUrl !== undefined && { acmeUrl: le.acmeUrl }),
    });
    const changed = await guardedApply(
      this.ctx,
      this.name,
      [renderNginxVhost(await nginxVhostSettings(this.ctx))],
      () => checks.nginx(),
    );
    if (changed.length > 0) {
      await systemd.reloadOrRestart('nginx');
    }
    await files.apply([renderCertbotDeployHook()]);
    await systemd.enable('certbot.timer', { now: true });
    return installed(await packages.installedVersion('certbot'));
  }

  async uninstall(): Promise<void> {
    const { host, systemd, checks } = this.ctx;
    await host.removeFile('/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx');
    await systemd.disable('certbot.timer', { now: true });
    // certificates are operator data and stay; the vhost falls back to
    // snakeoil only when nginx re-installs
    if (await this.ctx.systemd.isActive('nginx')) {
      await guardedApply(
        this.ctx,
        this.name,
        [renderNginxVhost({ portalPort: this.ctx.security.portalPort })],
        () => checks.nginx(),
      );
      await systemd.reloadOrRestart('nginx');
    }
  }
}

class IpsetInstaller implements ComponentInstaller {
  readonly name = 'ipset';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, ipset } = this.ctx;
    await packages.ensureInstalled(['ipset']);
    // the tool can be present while the kernel lacks ip_set (containers):
    // probe by actually creating the live set
    if (!(await ipset.ensureBlocklistSet())) {
      return {
        state: 'skipped',
        reason:
          'kernel lacks ip_set support (container?) — rtorrent ipv4_filter enforcement continues; re-run kobox install on a host with the module',
      };
    }
    return installed(await packages.installedVersion('ipset'));
  }

  async uninstall(): Promise<void> {
    // the in-kernel set evaporates at reboot; the package stays (harmless)
  }
}

class SchedulerInstaller implements ComponentInstaller {
  readonly name = 'scheduler';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, files, systemd, install } = this.ctx;
    // cron ships active on Debian 12; ensureInstalled is a fast no-op then
    await packages.ensureInstalled(['cron']);
    await files.apply([renderCronFile({ koboxBin: install.koboxBin })]);
    await systemd.enable('cron', { now: true });
    return installed(await packages.installedVersion('cron'));
  }

  async uninstall(): Promise<void> {
    // cron itself is a stock Debian service, not ours — only the file goes
    await this.ctx.host.removeFile(CRON_FILE);
  }
}

class Fail2banInstaller implements ComponentInstaller {
  readonly name = 'fail2ban';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    await this.ctx.packages.ensureInstalled(['fail2ban']);
    // jail content arrives via the chained render-fail2ban job
    await this.ctx.systemd.enable('fail2ban', { now: true });
    return installed(await this.ctx.packages.installedVersion('fail2ban'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.systemd.disable('fail2ban', { now: true });
    await this.ctx.host.removeFile('/etc/fail2ban/jail.d/kobox.local');
    await this.ctx.host.removeFile('/etc/fail2ban/filter.d/kobox-publickey-flood.conf');
    await this.ctx.host.removeFile('/etc/fail2ban/filter.d/kobox-portal.conf');
  }
}

// The SSR portal service (Phase 6): renders and enables kobox-portal.service.
// The kobox-portal account and DB group perms are set by kobox-core; nginx
// proxies this unit and gates /ru + /RPC-* against its session.
class PortalInstaller implements ComponentInstaller {
  readonly name = 'portal';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { files, systemd, install } = this.ctx;
    const changed = await files.apply([
      // the portal's own env: the install snapshot minus every worker-only
      // secret, so the non-root process never holds one it cannot use
      renderPortalEnv(install.workerEnv),
      renderPortalUnit({
        nodeBin: install.nodeBin,
        portalMain: `${install.currentLink}/dist/interfaces/http/main.js`,
      }),
    ]);
    await systemd.daemonReload();
    await systemd.enable('kobox-portal', { now: true });
    // enable --now leaves an ALREADY-running portal untouched: restart it so a
    // changed env (a secret withdrawn, a port moved) actually takes effect
    if (changed.length > 0) {
      await systemd.reloadOrRestart('kobox-portal');
    }
    return installed();
  }

  async uninstall(): Promise<void> {
    const { host, systemd } = this.ctx;
    await systemd.disable('kobox-portal', { now: true });
    await host.removeFile('/etc/systemd/system/kobox-portal.service');
    await host.removeFile(PORTAL_ENV);
    await systemd.daemonReload();
  }
}

const OPENVPN_UNITS = VPN_VARIANTS.map((variant) => `openvpn-server@kobox-${variant}`);

class OpenVpnInstaller implements ComponentInstaller {
  readonly name = 'openvpn';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, pkiProvision, pki, files, systemd, host, facts, security } = this.ctx;
    await packages.ensureInstalled(['openvpn', 'easy-rsa']);
    await pkiProvision.ensurePki();
    await host.ensureDir('/var/log/openvpn', '0755');
    // servers render here so the units can start; the chained render-openvpn
    // re-applies them (idempotent) and adds per-user profiles
    await files.apply(
      VPN_VARIANTS.map((variant) => renderOpenVpnServer(variant, security.vpn, pki.serverPaths())),
    );
    for (const unit of OPENVPN_UNITS) {
      await systemd.enable(unit);
    }
    if (facts.hasTunDevice) {
      for (const unit of OPENVPN_UNITS) {
        await systemd.start(unit);
      }
      return installed(await packages.installedVersion('openvpn'));
    }
    return installed(
      await packages.installedVersion('openvpn'),
      'no /dev/net/tun here — units enabled, tunnels validated on the VM',
    );
  }

  async uninstall(): Promise<void> {
    for (const unit of OPENVPN_UNITS) {
      await this.ctx.systemd.disable(unit, { now: true });
    }
  }
}

class PostfixInstaller implements ComponentInstaller {
  readonly name = 'postfix';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, systemd } = this.ctx;
    const mailname = await host.hostname();
    // preseed BEFORE apt: noninteractive postfix would otherwise install
    // itself unconfigured and refuse to start
    await host.preseedDebconf([
      'postfix postfix/main_mailer_type select Local only',
      `postfix postfix/mailname string ${mailname}`,
    ]);
    await packages.ensureInstalled(['postfix']);
    // main.cf belongs to postfix: postconf is the sanctioned editor, never a
    // file clobber (relay credentials arrive with the Phase 5 outbox)
    await host.postconf({
      inet_interfaces: 'loopback-only',
      mynetworks: '127.0.0.0/8 [::1]/128',
    });
    await systemd.enable('postfix', { now: true });
    return installed(await packages.installedVersion('postfix'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.systemd.disable('postfix', { now: true });
  }
}

// NFS (KEEP from prod: active): the per-user home exports arrive via the
// chained render-nfs-exports job; here we just install the server and enable it.
class NfsInstaller implements ComponentInstaller {
  readonly name = 'nfs';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, systemd } = this.ctx;
    await packages.ensureInstalled(['nfs-kernel-server']);
    await host.ensureDir('/etc/exports.d', '0755');
    await systemd.enable('nfs-server', { now: true });
    return installed(await packages.installedVersion('nfs-kernel-server'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.systemd.disable('nfs-server', { now: true });
    await this.ctx.host.removeFile('/etc/exports.d/kobox.exports');
  }
}

// Samba (KEEP from prod): user-level [homes] shares. Passwords are set
// out-of-band via `kobox set-samba-password` — never through the DB or a job.
class SambaInstaller implements ComponentInstaller {
  readonly name = 'samba';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, systemd, checks } = this.ctx;
    await packages.ensureInstalled(['samba']);
    const changed = await guardedApply(this.ctx, this.name, [renderSmbConf()], () => checks.samba());
    await systemd.enable('smbd', { now: true });
    if (changed.length > 0) {
      await systemd.reloadOrRestart('smbd');
    }
    return installed(await packages.installedVersion('samba'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.systemd.disable('smbd', { now: true });
    await this.ctx.host.removeFile('/etc/samba/smb.conf');
  }
}

// ShellInABox hardened to localhost (Phase 5 debt): reachable only through the
// portal's admin-gated /shell proxy.
class ShellinaboxInstaller implements ComponentInstaller {
  readonly name = 'shellinabox';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, files, systemd } = this.ctx;
    await packages.ensureInstalled(['shellinabox']);
    const changed = await files.apply([renderShellinaboxDefault()]);
    await systemd.enable('shellinabox', { now: true });
    if (changed.length > 0) {
      await systemd.reloadOrRestart('shellinabox');
    }
    return installed(await packages.installedVersion('shellinabox'));
  }

  async uninstall(): Promise<void> {
    await this.ctx.systemd.disable('shellinabox', { now: true });
    await this.ctx.host.removeFile('/etc/default/shellinabox');
  }
}

// Phase 8 — vendored NanoMon: a fetched, verified binary run non-root behind
// the portal's admin-gated /monitoring proxy. Skips honestly when unpinned
// (same env-driven rationale as ruTorrent).
class NanomonInstaller implements ComponentInstaller {
  readonly name = 'nanomon';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { host, artifacts, files, systemd, install } = this.ctx;
    if (install.nanomonUrl === undefined || install.nanomonSha256 === undefined) {
      return {
        state: 'skipped',
        reason:
          'no NanoMon release pinned — set KOBOX_NANOMON_URL and KOBOX_NANOMON_SHA256, then re-run kobox install',
      };
    }
    await host.ensureServiceAccount('nanomon');
    const marker = await host.readFile(NANOMON_MARKER);
    const binaryChanged = marker?.trim() !== install.nanomonSha256;
    if (binaryChanged) {
      await artifacts.fetchVerified(install.nanomonUrl, install.nanomonSha256, NANOMON_BIN);
      await host.setOwnership(NANOMON_BIN, 'root', 'root', '0755');
      await files.apply([
        {
          path: NANOMON_MARKER,
          content: `${install.nanomonSha256}\n`,
          mode: '0644',
          owner: 'root',
          group: 'root',
        },
      ]);
    }
    const unitChanged = await files.apply([renderNanomonUnit()]);
    await systemd.daemonReload();
    await systemd.enable('kobox-nanomon', { now: true });
    if (binaryChanged || unitChanged.length > 0) {
      await systemd.reloadOrRestart('kobox-nanomon');
    }
    return installed();
  }

  async uninstall(): Promise<void> {
    const { host, systemd } = this.ctx;
    await systemd.disable('kobox-nanomon', { now: true });
    await host.removeFile(NANOMON_UNIT);
    await host.removeFile(NANOMON_BIN);
    await systemd.daemonReload();
  }
}

// aria2's own scratch dir, deliberately OUTSIDE /var/lib/kobox: that tree is
// 2770 root:kobox-portal, which the non-root kobox-aria2 account can't even
// traverse — so staging lives under its own top-level dir it fully owns.
const DEFAULT_DDL_STAGING_DIR = '/var/lib/kobox-aria2';

// Phase 9 — aria2 download engine for debrid downloads. apt-installed, run
// non-root on a localhost-only RPC (secret from the config file, not argv).
// Skips honestly when no RPC secret is pinned.
// Link measurement. No unit and no schedule: it saturates the connection, so it
// only ever runs from an explicit admin request.
class SpeedtestInstaller implements ComponentInstaller {
  readonly name = 'speedtest';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { host, artifacts, install } = this.ctx;
    if (install.speedtestUrl === undefined || install.speedtestSha256 === undefined) {
      return {
        state: 'skipped',
        reason: 'no speedtest binary pinned — set KOBOX_SPEEDTEST_URL and KOBOX_SPEEDTEST_SHA256',
      };
    }
    const marker = await host.readFile(SPEEDTEST_MARKER);
    if (marker?.trim() === install.speedtestSha256) {
      return installed(install.speedtestSha256.slice(0, 12));
    }
    await artifacts.fetchVerified(install.speedtestUrl, install.speedtestSha256, SPEEDTEST_BIN);
    await host.setOwnership(SPEEDTEST_BIN, 'root', 'root', '0755');
    await host.ensureFile({
      path: SPEEDTEST_MARKER,
      content: `${install.speedtestSha256}\n`,
      mode: '0644',
      owner: 'root',
      group: 'root',
    });
    return installed(install.speedtestSha256.slice(0, 12));
  }

  async uninstall(): Promise<void> {
    const { host } = this.ctx;
    await host.removeFile(SPEEDTEST_BIN);
    await host.removeFile(SPEEDTEST_MARKER);
  }
}

class Aria2Installer implements ComponentInstaller {
  readonly name = 'aria2';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    const { packages, host, files, systemd, install } = this.ctx;
    if (install.aria2RpcSecret === undefined || install.aria2RpcSecret === '') {
      return {
        state: 'skipped',
        reason: 'no aria2 RPC secret — set KOBOX_ARIA2_RPC_SECRET, then re-run kobox install',
      };
    }
    const stagingDir = install.ddlStagingDir ?? DEFAULT_DDL_STAGING_DIR;
    await packages.ensureInstalled(['aria2']);
    await host.ensureServiceAccount('kobox-aria2');
    await host.ensureDir(stagingDir, '0750');
    await host.setOwnership(stagingDir, 'kobox-aria2', 'kobox-aria2', '0750');
    const changed = await files.apply([
      renderAria2Conf(install.aria2RpcSecret, stagingDir),
      renderAria2Unit(stagingDir),
    ]);
    await systemd.daemonReload();
    await systemd.enable('kobox-aria2', { now: true });
    if (changed.length > 0) {
      await systemd.reloadOrRestart('kobox-aria2');
    }
    return installed(await packages.installedVersion('aria2'));
  }

  async uninstall(): Promise<void> {
    const { host, systemd } = this.ctx;
    const unitPath = '/etc/systemd/system/kobox-aria2.service';
    // skip-when-unpinned: if aria2 was never installed there's nothing to tear
    // down — and no reason to pay a systemctl disable + daemon-reload for it
    if ((await host.readFile(unitPath)) === undefined) {
      return;
    }
    await systemd.disable('kobox-aria2', { now: true });
    await host.removeFile(unitPath);
    await host.removeFile('/etc/kobox/aria2.conf');
    await systemd.daemonReload();
  }
}

export function buildInstallers(ctx: InstallerContext): ReadonlyMap<string, ComponentInstaller> {
  const list: readonly ComponentInstaller[] = [
    new KoboxCoreInstaller(ctx),
    new AptSourcesInstaller(ctx),
    new SshdInstaller(ctx),
    new TweaksInstaller(ctx),
    new QuotaInstaller(ctx),
    new NginxInstaller(ctx),
    new RtorrentInstaller(ctx),
    new RutorrentInstaller(ctx),
    new BindInstaller(ctx),
    new DnscryptInstaller(ctx),
    new IpsetInstaller(ctx),
    new LetsencryptInstaller(ctx),
    new SchedulerInstaller(ctx),
    new Fail2banInstaller(ctx),
    new OpenVpnInstaller(ctx),
    new PostfixInstaller(ctx),
    new PortalInstaller(ctx),
    new NfsInstaller(ctx),
    new SambaInstaller(ctx),
    new ShellinaboxInstaller(ctx),
    new NanomonInstaller(ctx),
    new Aria2Installer(ctx),
    new SpeedtestInstaller(ctx),
  ];
  return new Map(list.map((entry) => [entry.name, entry]));
}
