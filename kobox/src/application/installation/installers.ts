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
import {
  renderAptSources,
  renderBindLocal,
  renderBindOptions,
  renderDnscryptConfig,
  renderFirewallBootUnit,
  renderNginxVhost,
  renderRutorrentConfig,
  renderSshdDropin,
  renderSysctlTweaks,
  renderWorkerEnv,
  renderWorkerUnit,
} from '../../domain/installation/rendering.js';
import type { VpnPkiPort, VpnPkiProvisionPort } from '../../domain/security/ports.js';
import { VPN_VARIANTS, renderOpenVpnServer } from '../../domain/security/vpn.js';
import type { ManagedFilesPort, RenderedFile } from '../../domain/shared/files.js';
import type { SecuritySettings } from '../security/settings.js';

export interface InstallSettings {
  readonly nodeBin: string;
  readonly workerMain: string;
  readonly manageAptSources: boolean;
  // release pin for the vendored ruTorrent archive (env-driven: shipping a
  // baked sha for a moving upstream would be a lie) — unset = honest skip
  readonly rutorrentUrl?: string;
  readonly rutorrentSha256?: string;
  readonly quotaFs?: string;
  readonly workerEnv: ReadonlyMap<string, string>;
}

export interface InstallerContext {
  readonly packages: PackagePort;
  readonly files: ManagedFilesPort;
  readonly systemd: SystemdPort;
  readonly checks: ConfigCheckPort;
  readonly host: InstallHostPort;
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
  const result = await check();
  if (result.ok) {
    return changed;
  }
  for (const file of rendered) {
    const prior = priors.get(file.path);
    if (prior === undefined) {
      await ctx.host.removeFile(file.path);
    } else {
      await ctx.files.apply([{ ...file, content: prior }]);
    }
  }
  throw new InstallGuardError(component, result.detail);
}

const WORKER_UNIT = '/etc/systemd/system/kobox-worker.service';
const FIREWALL_UNIT = '/etc/systemd/system/kobox-firewall.service';
const WORKER_ENV = '/etc/kobox/worker.env';
const SSHD_DROPIN = '/etc/ssh/sshd_config.d/90-kobox.conf';
const SYSCTL_DROPIN = '/etc/sysctl.d/90-kobox.conf';
const NGINX_VHOST = '/etc/nginx/conf.d/kobox.conf';
const HTPASSWD = '/etc/nginx/kobox.htpasswd';
const RUTORRENT_DIR = '/var/www/rutorrent';
const RUTORRENT_MARKER = `${RUTORRENT_DIR}/.kobox-artifact-sha256`;
const RUTORRENT_ARCHIVE = '/var/tmp/kobox/rutorrent.tar.gz';
const ZONES_SEED = '/etc/bind/kobox.zones.blacklists';
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
    await host.ensureDir('/etc/kobox', '0755');
    await host.ensureDir('/var/lib/kobox', '0700');
    await host.ensureDir('/var/spool/kobox/events', '1733');
    await files.apply([
      renderWorkerEnv(install.workerEnv),
      renderWorkerUnit({ nodeBin: install.nodeBin, workerMain: install.workerMain }),
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
    const { packages, host, systemd, checks, security } = this.ctx;
    await packages.ensureInstalled(['nginx', 'php-fpm', 'ssl-cert']);
    // deny-by-default: an EMPTY htpasswd rejects everyone until the portal
    // phase wires real accounts; an existing file is never overwritten
    await host.ensureFile({
      path: HTPASSWD,
      content: '',
      mode: '0640',
      owner: 'root',
      group: 'www-data',
    });
    const changed = await guardedApply(
      this.ctx,
      this.name,
      [renderNginxVhost({ portalPort: security.portalPort })],
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
    const changed = await guardedApply(
      this.ctx,
      this.name,
      [renderBindLocal(), renderBindOptions()],
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

class PglInstaller implements ComponentInstaller {
  readonly name = 'pgl';

  constructor(private readonly ctx: InstallerContext) {}

  async install(): Promise<InstallOutcome> {
    if (!(await this.ctx.packages.isAvailable('pgld'))) {
      // the legacy shipped vendored Qt4-era debs; Debian 12 has neither —
      // rtorrent-side enforcement (per-user ipv4_filter) keeps working
      return {
        state: 'skipped',
        reason:
          'pgl is not packaged for Debian 12 (legacy used vendored Qt4 debs); ipset-based replacement deferred to Phase 5',
      };
    }
    await this.ctx.packages.ensureInstalled(['pgld', 'pglcmd']);
    await this.ctx.systemd.enable('pgl', { now: true });
    return installed(await this.ctx.packages.installedVersion('pgld'));
  }

  async uninstall(): Promise<void> {
    if (await this.ctx.systemd.isActive('pgl')) {
      await this.ctx.systemd.disable('pgl', { now: true });
    }
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
    new PglInstaller(ctx),
    new Fail2banInstaller(ctx),
    new OpenVpnInstaller(ctx),
    new PostfixInstaller(ctx),
  ];
  return new Map(list.map((entry) => [entry.name, entry]));
}
