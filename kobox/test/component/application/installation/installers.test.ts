import { beforeEach, describe, expect, it } from 'vitest';
import {
  InstallGuardError,
  buildInstallers,
  type ComponentInstaller,
  type InstallerContext,
} from '../../../../src/application/installation/installers.js';
import type { CertbotRequest } from '../../../../src/application/maintenance/CertbotPort.js';
import type { DebridKeyPairPort } from '../../../../src/domain/ddl/ports.js';
import type { SystemFacts } from '../../../../src/domain/installation/ports.js';
import { Cidr } from '../../../../src/domain/security/Cidr.js';
import { FakeConfigChecks } from '../../../../src/infrastructure/system/fakes/FakeConfigChecks.js';
import { FakeInstallHost } from '../../../../src/infrastructure/system/fakes/FakeInstallHost.js';
import { FakeIpset } from '../../../../src/infrastructure/system/fakes/FakeIpset.js';
import { FakePackages } from '../../../../src/infrastructure/system/fakes/FakePackages.js';
import { FakeSystemd } from '../../../../src/infrastructure/system/fakes/FakeSystemd.js';
import { FakeVpnPki } from '../../../../src/infrastructure/system/fakes/FakeVpnPki.js';

const healthyFacts: SystemFacts = {
  osId: 'debian',
  osVersionId: '12',
  arch: 'amd64',
  euid: 0,
  rootFsType: 'ext4',
  hasDefaultRoute: true,
  hasTunDevice: true,
};

interface World {
  readonly packages: FakePackages;
  readonly host: FakeInstallHost;
  readonly systemd: FakeSystemd;
  readonly checks: FakeConfigChecks;
  readonly pki: FakeVpnPki;
  readonly ipset: FakeIpset;
  readonly debridKeys: FakeDebridKeyPair;
  readonly certbot: FakeCertbot;
  readonly installers: ReadonlyMap<string, ComponentInstaller>;
}

// records requests and materializes the live chain like real certbot would
class FakeCertbot {
  readonly requests: CertbotRequest[] = [];
  failWith: string | undefined = undefined;

  constructor(private readonly host: FakeInstallHost) {}

  async obtain(request: CertbotRequest): Promise<void> {
    if (this.failWith !== undefined) {
      throw new Error(this.failWith);
    }
    this.requests.push(request);
    await this.host.ensureFile({
      path: `/etc/letsencrypt/live/${request.domain}/fullchain.pem`,
      content: 'CHAIN',
      mode: '0644',
      owner: 'root',
      group: 'root',
    });
  }
}

// Records that the sealing pair was provisioned; the real generation is
// integration-tested (it must never regenerate over an existing private key).
class FakeDebridKeyPair implements DebridKeyPairPort {
  calls = 0;
  ensurePair(): Promise<void> {
    this.calls += 1;
    return Promise.resolve();
  }
}

function buildWorld(overrides?: {
  facts?: Partial<SystemFacts>;
  manageAptSources?: boolean;
  quotaFs?: string;
  rutorrentPin?: 'none';
  nanomonPin?: 'none';
  aria2Pin?: 'none';
  speedtestPin?: 'none';
  letsencrypt?: { domain: string; email: string; acmeUrl?: string };
}): World {
  const packages = new FakePackages();
  const host = new FakeInstallHost();
  const systemd = new FakeSystemd();
  const checks = new FakeConfigChecks();
  const pki = new FakeVpnPki();
  const ipset = new FakeIpset();
  const debridKeys = new FakeDebridKeyPair();
  const certbot = new FakeCertbot(host);
  const ctx: InstallerContext = {
    packages,
    files: host,
    systemd,
    checks,
    host,
    ipset,
    debridKeys,
    certbot,
    pki,
    pkiProvision: pki,
    artifacts: host,
    facts: { ...healthyFacts, ...overrides?.facts },
    security: {
      sshPort: 22,
      portalPort: 8189,
      vpn: {
        tunGwPort: 8193,
        tunPort: 8194,
        tapPort: 8195,
        tunGwSubnet: Cidr.parse('10.0.0.0/24'),
        tunSubnet: Cidr.parse('10.0.1.0/24'),
        tapSubnet: Cidr.parse('10.0.2.0/24'),
      },
    },
    install: {
      nodeBin: '/usr/bin/node',
      sourceDir: '/opt/kobox-src',
      currentLink: '/opt/kobox/current',
      koboxBin: '/usr/local/bin/kobox',
      manageAptSources: overrides?.manageAptSources ?? false,
      ...(overrides?.rutorrentPin !== 'none' && {
        rutorrentUrl: 'https://releases.example.net/rutorrent-4.3.9.tar.gz',
        rutorrentSha256: 'a'.repeat(64),
      }),
      ...(overrides?.nanomonPin !== 'none' && {
        nanomonUrl: 'https://releases.example.net/nanomon-x86_64',
        nanomonSha256: 'b'.repeat(64),
      }),
      ...(overrides?.speedtestPin !== 'none' && {
        speedtestUrl: 'https://releases.example.net/librespeed-cli',
        speedtestSha256: 'c'.repeat(64),
      }),
      ...(overrides?.aria2Pin !== 'none' && {
        aria2RpcSecret: 'test-rpc-secret',
        ddlStagingDir: '/var/lib/kobox-aria2',
      }),
      ...(overrides?.quotaFs !== undefined && { quotaFs: overrides.quotaFs }),
      ...(overrides?.letsencrypt !== undefined && { letsencrypt: overrides.letsencrypt }),
      dbPath: '/var/lib/kobox/kobox.db',
      workerEnv: new Map([
        ['KOBOX_DB', '/var/lib/kobox/kobox.db'],
        // a worker-only secret: the root worker gets it, the portal must not
        ['KOBOX_ALLDEBRID_APIKEY', 'the-debrid-key'],
      ]),
    },
  };
  return {
    packages, host, systemd, checks, pki, ipset, debridKeys, certbot,
    installers: buildInstallers(ctx),
  };
}

function installer(world: World, name: string): ComponentInstaller {
  const found = world.installers.get(name);
  if (!found) {
    throw new Error(`no installer for ${name}`);
  }
  return found;
}

let world: World;

beforeEach(() => {
  world = buildWorld();
});

describe('kobox-core installer', () => {
  it('should_create_dirs_render_units_and_activate_the_worker', async () => {
    const outcome = await installer(world, 'kobox-core').install();

    expect(outcome.state).toBe('installed');
    expect(world.host.dirs.get('/etc/kobox')).toBe('0755');
    // Phase 6: the DB dir is shared with the non-root portal (setgid group)
    expect(world.host.dirs.get('/var/lib/kobox')).toBe('2770');
    expect(world.host.serviceAccounts.has('kobox-portal')).toBe(true);
    expect(world.host.ownership.get('/var/lib/kobox')).toEqual({
      owner: 'root',
      group: 'kobox-portal',
      mode: '2770',
    });
    // The DIRECTORY being setgid is not enough: the database file is created by
    // whichever CLI invocation opens it first, and on a fresh box that happens
    // before this installer runs — so it lands root:root 0644 and the non-root
    // portal cannot write to it. Seen on a real install: the portal restart-
    // looped on "attempt to write a readonly database".
    expect(world.host.ownership.get('/var/lib/kobox/kobox.db')).toEqual({
      owner: 'root',
      group: 'kobox-portal',
      mode: '0660',
    });
    expect(world.host.dirs.get('/var/spool/kobox/events')).toBe('1733');
    // the unit executes THROUGH the current symlink: upgrades flip the link,
    // never the unit (§5.6 versioned releases)
    expect(world.host.contentAt('/etc/systemd/system/kobox-worker.service')).toContain(
      'ExecStart=/usr/bin/node /opt/kobox/current/dist/interfaces/worker/main.js',
    );
    expect(world.host.symlinks.get('/opt/kobox/current')).toBe('/opt/kobox-src');
    expect(world.host.contentAt('/etc/kobox/worker.env')).toContain(
      'KOBOX_DB=/var/lib/kobox/kobox.db',
    );
    // the root worker is the one process that DOES hold the secrets
    expect(world.host.contentAt('/etc/kobox/worker.env')).toContain(
      'KOBOX_ALLDEBRID_APIKEY=the-debrid-key',
    );
    expect(world.systemd.log).toContain('daemon-reload');
    expect(world.systemd.log).toContain('enable-now kobox-worker');
    // boot oneshot is enabled but NOT started: no rules file exists yet
    expect(world.systemd.log).toContain('enable kobox-firewall');
  });

  it('should_provision_the_debrid_sealing_pair', async () => {
    await installer(world, 'kobox-core').install();

    // per-user debrid keys are useless without it; the adapter itself guarantees
    // an existing private half is never regenerated
    expect(world.debridKeys.calls).toBe(1);
  });

  it('should_uninstall_units_but_never_touch_the_database_dir', async () => {
    await installer(world, 'kobox-core').install();

    await installer(world, 'kobox-core').uninstall();

    expect(world.systemd.log).toContain('disable-now kobox-worker');
    expect(world.host.contentAt('/etc/systemd/system/kobox-worker.service')).toBeUndefined();
    expect(world.host.contentAt('/etc/kobox/worker.env')).toBeUndefined();
    expect(world.host.dirs.has('/var/lib/kobox')).toBe(true);
  });
});

describe('sshd installer (the never-break-SSH guard)', () => {
  it('should_install_the_dropin_and_reload_only_after_sshd_t_passes', async () => {
    const outcome = await installer(world, 'sshd').install();

    expect(outcome.state).toBe('installed');
    expect(world.packages.installed).toContain('openssh-server');
    expect(world.host.contentAt('/etc/ssh/sshd_config.d/90-kobox.conf')).toContain(
      'PermitRootLogin prohibit-password',
    );
    expect(world.systemd.log).toContain('reload-or-restart ssh');
  });

  it('should_remove_the_dropin_and_throw_when_sshd_t_fails', async () => {
    world.checks.failSshd('Bad configuration option');

    await expect(installer(world, 'sshd').install()).rejects.toThrow(InstallGuardError);

    expect(world.host.contentAt('/etc/ssh/sshd_config.d/90-kobox.conf')).toBeUndefined();
    expect(world.systemd.log).not.toContain('reload-or-restart ssh');
  });

  it('should_roll_back_even_when_the_checker_itself_dies', async () => {
    // a checker spawn failure/timeout must not leave an unvalidated render
    world.checks.throwSshd(new Error('sshd binary vanished'));

    await expect(installer(world, 'sshd').install()).rejects.toThrow('sshd binary vanished');

    expect(world.host.contentAt('/etc/ssh/sshd_config.d/90-kobox.conf')).toBeUndefined();
  });

  it('should_not_reload_sshd_when_nothing_changed_on_re_run', async () => {
    await installer(world, 'sshd').install();
    world.systemd.log.length = 0;

    await installer(world, 'sshd').install();

    expect(world.systemd.log).not.toContain('reload-or-restart ssh');
  });
});

describe('nginx installer', () => {
  it('should_remove_the_debian_default_site_that_would_swallow_the_acme_port', async () => {
    // stock Debian nginx ships sites-enabled/default with `listen 80
    // default_server`: while it exists, every HTTP-01 challenge lands on the
    // wrong vhost and Let's Encrypt issuance can never validate
    await world.host.apply([
      {
        path: '/etc/nginx/sites-enabled/default',
        content: 'server { listen 80 default_server; }',
        mode: '0644',
        owner: 'root',
        group: 'root',
      },
    ]);

    await installer(world, 'nginx').install();

    expect(world.host.contentAt('/etc/nginx/sites-enabled/default')).toBeUndefined();
  });

  it('should_render_a_session_authed_vhost_and_hold_the_rpc_include_dir', async () => {
    await installer(world, 'nginx').install();

    expect(world.packages.installed).toEqual(
      expect.arrayContaining(['nginx', 'php-fpm', 'ssl-cert']),
    );
    const vhost = world.host.contentAt('/etc/nginx/conf.d/kobox.conf') ?? '';
    expect(vhost).toContain('listen 8189 ssl');
    // Phase 6: no shared Basic Auth; the portal owns auth
    expect(vhost).not.toContain('auth_basic');
    expect(world.host.dirs.get('/etc/nginx/kobox.d')).toBe('0755');
    expect(world.systemd.log).toContain('enable-now nginx');
  });

  it('should_drop_a_leftover_htpasswd_from_an_earlier_phase', async () => {
    await world.host.apply([
      {
        path: '/etc/nginx/kobox.htpasswd',
        content: 'alice:$hash',
        mode: '0640',
        owner: 'root',
        group: 'www-data',
      },
    ]);

    await installer(world, 'nginx').install();

    expect(world.host.contentAt('/etc/nginx/kobox.htpasswd')).toBeUndefined();
  });

  it('should_roll_back_the_vhost_when_nginx_t_fails', async () => {
    world.checks.failNginx('unexpected token');

    await expect(installer(world, 'nginx').install()).rejects.toThrow(InstallGuardError);

    expect(world.host.contentAt('/etc/nginx/conf.d/kobox.conf')).toBeUndefined();
  });
});

describe('portal installer', () => {
  it('should_render_the_non_root_unit_and_enable_it', async () => {
    const outcome = await installer(world, 'portal').install();

    expect(outcome.state).toBe('installed');
    const unit = world.host.contentAt('/etc/systemd/system/kobox-portal.service') ?? '';
    expect(unit).toContain('User=kobox-portal');
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/kobox/current/dist/interfaces/http/main.js');
    expect(world.systemd.log).toContain('daemon-reload');
    expect(world.systemd.log).toContain('enable-now kobox-portal');
  });

  it('should_give_the_portal_its_own_env_without_the_worker_secrets', async () => {
    await installer(world, 'portal').install();

    const env = world.host.fileAt('/etc/kobox/portal.env');
    // the config it needs, none of the secrets it never uses
    expect(env?.content).toContain('KOBOX_DB=/var/lib/kobox/kobox.db');
    expect(env?.content).not.toContain('the-debrid-key');
    // readable by the portal identity only
    expect(env?.mode).toBe('0640');
    expect(env?.group).toBe('kobox-portal');
    expect(world.host.contentAt('/etc/systemd/system/kobox-portal.service')).toContain(
      'EnvironmentFile=-/etc/kobox/portal.env',
    );
  });

  it('should_disable_and_remove_the_unit_on_uninstall', async () => {
    await installer(world, 'portal').install();

    await installer(world, 'portal').uninstall();

    expect(world.systemd.log).toContain('disable-now kobox-portal');
    expect(world.host.contentAt('/etc/systemd/system/kobox-portal.service')).toBeUndefined();
    expect(world.host.contentAt('/etc/kobox/portal.env')).toBeUndefined();
  });
});

describe('vendored extras installers', () => {
  it('should_install_the_nfs_server_and_hold_the_exports_dir', async () => {
    const outcome = await installer(world, 'nfs').install();

    expect(outcome.state).toBe('installed');
    expect(world.packages.installed).toContain('nfs-kernel-server');
    expect(world.host.dirs.get('/etc/exports.d')).toBe('0755');
    expect(world.systemd.log).toContain('enable-now nfs-server');
  });

  it('should_render_the_samba_config_under_the_testparm_guard', async () => {
    const outcome = await installer(world, 'samba').install();

    expect(outcome.state).toBe('installed');
    expect(world.host.contentAt('/etc/samba/smb.conf')).toContain('[homes]');
    expect(world.systemd.log).toContain('enable-now smbd');
  });

  it('should_roll_back_the_samba_config_when_testparm_fails', async () => {
    world.checks.failSamba('Unknown parameter encountered');

    await expect(installer(world, 'samba').install()).rejects.toThrow(InstallGuardError);

    expect(world.host.contentAt('/etc/samba/smb.conf')).toBeUndefined();
  });

  it('should_bind_shellinabox_to_localhost', async () => {
    const outcome = await installer(world, 'shellinabox').install();

    expect(outcome.state).toBe('installed');
    expect(world.host.contentAt('/etc/default/shellinabox')).toContain('--localhost-only');
    expect(world.systemd.log).toContain('enable-now shellinabox');
  });
});

describe('bind installer', () => {
  it('should_restore_the_previous_stock_config_when_named_checkconf_fails', async () => {
    await world.host.apply([
      {
        path: '/etc/bind/named.conf.options',
        content: 'stock-debian-options',
        mode: '0644',
        owner: 'root',
        group: 'bind',
      },
    ]);
    world.checks.failBind('unknown option');

    await expect(installer(world, 'bind').install()).rejects.toThrow(InstallGuardError);

    expect(world.host.contentAt('/etc/bind/named.conf.options')).toBe('stock-debian-options');
  });

  it('should_forward_to_dnscrypt_only_when_dnscrypt_is_actually_installed', async () => {
    await installer(world, 'dnscrypt').install(); // dnscrypt-proxy available here
    await installer(world, 'bind').install();
    expect(world.host.contentAt('/etc/bind/named.conf.options')).toContain('port 52');

    const debian12 = buildWorld();
    debian12.packages.markUnavailable('dnscrypt-proxy');
    await installer(debian12, 'dnscrypt').install(); // skipped
    await installer(debian12, 'bind').install();
    // forward-only to a dead port would break the box's DNS entirely
    expect(debian12.host.contentAt('/etc/bind/named.conf.options')).not.toContain('port 52');
  });

  it('should_seed_the_blacklist_zones_file_without_stealing_it_from_render_whitelist', async () => {
    await installer(world, 'bind').install();
    const seeded = world.host.contentAt('/etc/bind/kobox.zones.blacklists');
    expect(seeded).toBeDefined();

    await world.host.apply([
      {
        path: '/etc/bind/kobox.zones.blacklists',
        content: 'zone "tracker.example.org" { type master; };',
        mode: '0644',
        owner: 'root',
        group: 'bind',
      },
    ]);
    await installer(world, 'bind').install();

    expect(world.host.contentAt('/etc/bind/kobox.zones.blacklists')).toContain(
      'tracker.example.org',
    );
  });
});

describe('dnscrypt installer', () => {
  it('should_disable_socket_activation_and_own_the_toml', async () => {
    await installer(world, 'dnscrypt').install();

    expect(world.systemd.log).toContain('disable-now dnscrypt-proxy.socket');
    expect(world.host.contentAt('/etc/dnscrypt-proxy/dnscrypt-proxy.toml')).toContain(
      "listen_addresses = ['127.0.0.1:52']",
    );
    expect(world.systemd.log).toContain('enable-now dnscrypt-proxy');
  });

  it('should_skip_honestly_where_debian_does_not_package_it', async () => {
    // bookworm dropped dnscrypt-proxy (not even in backports)
    world.packages.markUnavailable('dnscrypt-proxy');

    const outcome = await installer(world, 'dnscrypt').install();

    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(outcome.state === 'skipped' && outcome.reason).toContain('not packaged');
    expect(world.packages.installed).not.toContain('dnscrypt-proxy');
  });
});

describe('letsencrypt installer', () => {
  it('should_skip_with_guidance_when_no_public_fqdn_is_configured', async () => {
    const outcome = await installer(world, 'letsencrypt').install();

    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(outcome.state === 'skipped' && outcome.reason).toContain('KOBOX_LE_DOMAIN');
    // snakeoil stays: no vhost rewrite happened
    expect(world.certbot.requests).toEqual([]);
  });

  it('should_obtain_the_cert_via_webroot_and_flip_the_vhost_to_the_live_chain', async () => {
    const w = buildWorld({ letsencrypt: { domain: 'box.example.org', email: 'ops@example.org' } });
    await installer(w, 'nginx').install(); // snakeoil first

    const outcome = await installer(w, 'letsencrypt').install();

    expect(outcome.state).toBe('installed');
    expect(w.packages.installed).toContain('certbot');
    expect(w.host.dirs.get('/var/www/acme')).toBe('0755');
    expect(w.certbot.requests).toEqual([
      { domain: 'box.example.org', email: 'ops@example.org', webroot: '/var/www/acme' },
    ]);
    const vhost = w.host.contentAt('/etc/nginx/conf.d/kobox.conf') ?? '';
    expect(vhost).toContain('ssl_certificate /etc/letsencrypt/live/box.example.org/fullchain.pem;');
    expect(vhost).not.toContain('snakeoil');
    expect(w.host.contentAt('/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx')).toContain(
      'systemctl reload nginx',
    );
    expect(w.systemd.log).toContain('enable-now certbot.timer');
  });

  it('should_fail_the_component_and_keep_snakeoil_when_issuance_fails', async () => {
    const w = buildWorld({ letsencrypt: { domain: 'box.example.org', email: 'ops@example.org' } });
    await installer(w, 'nginx').install();
    w.certbot.failWith = 'challenge failed';

    await expect(installer(w, 'letsencrypt').install()).rejects.toThrow('challenge failed');

    expect(w.host.contentAt('/etc/nginx/conf.d/kobox.conf')).toContain('snakeoil');
  });

  it('should_pass_a_custom_acme_directory_through_to_certbot', async () => {
    const w = buildWorld({
      letsencrypt: {
        domain: 'box.example.org',
        email: 'ops@example.org',
        acmeUrl: 'https://acme.example.net:14000/dir',
      },
    });
    await installer(w, 'nginx').install();

    await installer(w, 'letsencrypt').install();

    expect(w.certbot.requests[0]?.acmeUrl).toBe('https://acme.example.net:14000/dir');
  });

  it('should_render_the_live_chain_directly_on_nginx_re_runs_once_issued', async () => {
    // anti-drift: a full re-install must not flap the vhost back to snakeoil
    const w = buildWorld({ letsencrypt: { domain: 'box.example.org', email: 'ops@example.org' } });
    await installer(w, 'nginx').install();
    await installer(w, 'letsencrypt').install();

    await installer(w, 'nginx').install();

    expect(w.host.contentAt('/etc/nginx/conf.d/kobox.conf')).not.toContain('snakeoil');
  });
});

describe('ipset installer', () => {
  it('should_install_the_tool_and_create_the_live_set', async () => {
    const outcome = await installer(world, 'ipset').install();

    expect(outcome.state).toBe('installed');
    expect(world.packages.installed).toContain('ipset');
    expect(world.ipset.ensured).toBe(1);
  });

  it('should_skip_honestly_when_the_kernel_lacks_ip_set', async () => {
    world.ipset.supported = false;

    const outcome = await installer(world, 'ipset').install();

    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(outcome.state === 'skipped' && outcome.reason).toContain('kernel');
  });
});

describe('scheduler installer', () => {
  it('should_render_the_declarative_cron_file_and_activate_cron', async () => {
    const outcome = await installer(world, 'scheduler').install();

    expect(outcome.state).toBe('installed');
    expect(world.packages.installed).toContain('cron');
    const content = world.host.contentAt('/etc/cron.d/kobox');
    expect(content).toContain('*/5 * * * * root /usr/local/bin/kobox send-mails');
    expect(content).toContain('30 5 * * * root /usr/local/bin/kobox run-backup');
    expect(world.systemd.log).toContain('enable-now cron');
  });

  it('should_uninstall_by_removing_the_cron_file_only', async () => {
    await installer(world, 'scheduler').install();

    await installer(world, 'scheduler').uninstall();

    expect(world.host.contentAt('/etc/cron.d/kobox')).toBeUndefined();
    // cron itself stays: it is a stock Debian service, not ours
    expect(world.systemd.log).not.toContain('disable-now cron');
  });
});

describe('apt-sources installer', () => {
  it('should_skip_unless_the_operator_opted_in', async () => {
    const outcome = await installer(world, 'apt-sources').install();
    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(world.host.contentAt('/etc/apt/sources.list')).toBeUndefined();
  });

  it('should_render_and_refresh_when_opted_in', async () => {
    const opted = buildWorld({ manageAptSources: true });
    const outcome = await installer(opted, 'apt-sources').install();

    expect(outcome.state).toBe('installed');
    expect(opted.host.contentAt('/etc/apt/sources.list')).toContain('bookworm-security');
    expect(opted.packages.refreshCount).toBe(1);
  });
});

describe('openvpn installer', () => {
  it('should_bootstrap_the_pki_render_servers_and_start_when_tun_exists', async () => {
    const outcome = await installer(world, 'openvpn').install();

    expect(outcome.state).toBe('installed');
    expect(world.pki.pkiEnsured).toBe(true);
    expect(world.host.contentAt('/etc/openvpn/server/kobox-tun-gw.conf')).toContain('dh none');
    for (const unit of [
      'openvpn-server@kobox-tun-gw',
      'openvpn-server@kobox-tun',
      'openvpn-server@kobox-tap',
    ]) {
      expect(world.systemd.log).toContain(`enable ${unit}`);
      expect(world.systemd.log).toContain(`start ${unit}`);
    }
  });

  it('should_not_start_tunnels_without_a_tun_device', async () => {
    const container = buildWorld({ facts: { hasTunDevice: false } });

    const outcome = await installer(container, 'openvpn').install();

    expect(outcome.state).toBe('installed');
    expect(container.systemd.log).toContain('enable openvpn-server@kobox-tun-gw');
    expect(container.systemd.log.filter((line) => line.startsWith('start '))).toEqual([]);
  });
});

describe('postfix installer', () => {
  it('should_preseed_debconf_then_pin_loopback_only_via_postconf', async () => {
    await installer(world, 'postfix').install();

    expect(world.host.preseeded.join('\n')).toContain('postfix/main_mailer_type');
    expect(world.host.postconfSettings.inet_interfaces).toBe('loopback-only');
    expect(world.systemd.log).toContain('enable-now postfix');
  });
});

describe('quota installer', () => {
  it('should_activate_quota_when_the_mount_already_has_usrquota', async () => {
    const withQuota = buildWorld({ quotaFs: '/home' });
    withQuota.host.setMountOptions('/home', ['rw', 'relatime', 'usrquota']);

    const outcome = await installer(withQuota, 'quota').install();

    expect(outcome.state).toBe('installed');
    expect(withQuota.host.quotaActivated).toEqual(['/home']);
  });

  it('should_install_tools_and_print_guidance_when_fstab_is_not_ready', async () => {
    const withQuota = buildWorld({ quotaFs: '/home' });
    withQuota.host.setMountOptions('/home', ['rw', 'relatime']);

    const outcome = await installer(withQuota, 'quota').install();

    expect(outcome.state).toBe('installed');
    expect(withQuota.host.quotaActivated).toEqual([]);
    expect(outcome.state === 'installed' && outcome.detail).toContain('usrquota');
  });
});

describe('rutorrent installer', () => {
  it('should_skip_with_guidance_when_no_release_pin_is_configured', async () => {
    const unpinned = buildWorld({ rutorrentPin: 'none' });

    const outcome = await installer(unpinned, 'rutorrent').install();

    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(outcome.state === 'skipped' && outcome.reason).toContain('KOBOX_RUTORRENT_URL');
    expect(unpinned.host.fetched).toHaveLength(0);
  });

  it('should_start_php_now_rather_than_leaving_it_for_the_next_reboot', async () => {
    // ruTorrent is a PHP application. Enabling the unit without starting it
    // leaves it working only after the box is rebooted — seen on a real
    // install, where /ru/ answered 403 until php-fpm was started by hand.
    await installer(world, 'rutorrent').install();

    expect(world.systemd.log).toContain('enable-now php8.2-fpm');
  });

  it('should_fetch_verify_extract_once_and_render_the_global_config', async () => {
    await installer(world, 'rutorrent').install();

    expect(world.host.fetched).toEqual([
      ['https://releases.example.net/rutorrent-4.3.9.tar.gz', 'a'.repeat(64)],
    ]);
    expect(world.host.extracted).toHaveLength(1);
    expect(world.host.contentAt('/var/www/rutorrent/conf/config.php')).toContain('$scgi_host');

    await installer(world, 'rutorrent').install();

    expect(world.host.fetched).toHaveLength(1); // marker matched, no re-download
  });
});

describe('nanomon installer', () => {
  it('should_skip_with_guidance_when_no_release_pin_is_configured', async () => {
    const unpinned = buildWorld({ nanomonPin: 'none' });

    const outcome = await installer(unpinned, 'nanomon').install();

    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(outcome.state === 'skipped' && outcome.reason).toContain('KOBOX_NANOMON_URL');
    expect(unpinned.host.fetched).toHaveLength(0);
  });

  it('should_fetch_the_binary_create_the_account_and_enable_the_unit', async () => {
    const outcome = await installer(world, 'nanomon').install();

    expect(outcome.state).toBe('installed');
    expect(world.host.fetched).toEqual([
      ['https://releases.example.net/nanomon-x86_64', 'b'.repeat(64)],
    ]);
    expect(world.host.serviceAccounts.has('nanomon')).toBe(true);
    expect(world.host.contentAt('/etc/systemd/system/kobox-nanomon.service')).toContain(
      'User=nanomon',
    );
    expect(world.systemd.log).toContain('enable-now kobox-nanomon');

    await installer(world, 'nanomon').install();

    expect(world.host.fetched).toHaveLength(1); // marker matched, no re-download
  });

  it('should_remove_the_unit_and_binary_on_uninstall', async () => {
    await installer(world, 'nanomon').install();

    await installer(world, 'nanomon').uninstall();

    expect(world.systemd.log).toContain('disable-now kobox-nanomon');
    expect(world.host.contentAt('/usr/local/bin/nanomon')).toBeUndefined();
  });
});

describe('aria2 installer', () => {
  it('should_skip_when_no_rpc_secret_is_configured', async () => {
    const unpinned = buildWorld({ aria2Pin: 'none' });

    const outcome = await installer(unpinned, 'aria2').install();

    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(outcome.state === 'skipped' && outcome.reason).toContain('KOBOX_ARIA2_RPC_SECRET');
  });

  it('should_install_aria2_non_root_with_a_config_backed_secret', async () => {
    const outcome = await installer(world, 'aria2').install();

    expect(outcome.state).toBe('installed');
    expect(world.packages.installed).toContain('aria2');
    expect(world.host.serviceAccounts.has('kobox-aria2')).toBe(true);
    // the secret lives in the config (0640), not on the command line
    const conf = world.host.fileAt('/etc/kobox/aria2.conf');
    expect(conf?.content).toContain('rpc-secret=test-rpc-secret');
    expect(conf?.mode).toBe('0640');
    expect(world.host.contentAt('/etc/systemd/system/kobox-aria2.service')).toContain(
      'User=kobox-aria2',
    );
    expect(world.systemd.log).toContain('enable-now kobox-aria2');
  });

  it('should_disable_and_remove_the_unit_on_uninstall', async () => {
    await installer(world, 'aria2').install();

    await installer(world, 'aria2').uninstall();

    expect(world.systemd.log).toContain('disable-now kobox-aria2');
    expect(world.host.contentAt('/etc/systemd/system/kobox-aria2.service')).toBeUndefined();
    expect(world.host.contentAt('/etc/kobox/aria2.conf')).toBeUndefined();
  });

  it('should_be_a_no_op_uninstall_when_never_installed', async () => {
    const unpinned = buildWorld({ aria2Pin: 'none' });

    await installer(unpinned, 'aria2').uninstall();

    // no systemctl disable / daemon-reload paid for a component that was skipped
    expect(unpinned.systemd.log).not.toContain('kobox-aria2');
  });
});

describe('speedtest installer', () => {
  it('should_skip_when_no_binary_is_pinned', async () => {
    const unpinned = buildWorld({ speedtestPin: 'none' });

    const outcome = await installer(unpinned, 'speedtest').install();

    expect(outcome).toMatchObject({ state: 'skipped' });
    expect(outcome.state === 'skipped' && outcome.reason).toContain('KOBOX_SPEEDTEST_URL');
  });

  it('should_vendor_the_verified_binary_and_remember_its_sum', async () => {
    const outcome = await installer(world, 'speedtest').install();

    expect(outcome.state).toBe('installed');
    // the tarball is fetched then extracted; the binary lives in its own dir
    expect(world.host.extracted).toContainEqual([
      '/var/tmp/kobox/librespeed-cli.tar.gz',
      '/usr/local/lib/kobox-speedtest',
    ]);
    expect(world.host.contentAt('/etc/kobox/speedtest.sha256')).toContain('c'.repeat(64));
  });

  it('should_not_refetch_when_the_pinned_sum_already_matches', async () => {
    await installer(world, 'speedtest').install();
    const fetchedOnce = world.host.fetched.length;

    await installer(world, 'speedtest').install();

    expect(world.host.fetched).toHaveLength(fetchedOnce);
  });

  it('should_remove_the_binary_on_uninstall', async () => {
    await installer(world, 'speedtest').install();

    await installer(world, 'speedtest').uninstall();

    expect(world.host.contentAt('/usr/local/lib/kobox-speedtest/librespeed-cli')).toBeUndefined();
  });
});

describe('fail2ban installer', () => {
  it('should_install_and_enable_the_service', async () => {
    await installer(world, 'fail2ban').install();

    expect(world.packages.installed).toContain('fail2ban');
    expect(world.systemd.log).toContain('enable-now fail2ban');
  });
});
