import { beforeEach, describe, expect, it } from 'vitest';
import {
  InstallGuardError,
  buildInstallers,
  type ComponentInstaller,
  type InstallerContext,
} from '../../../../src/application/installation/installers.js';
import type { CertbotRequest } from '../../../../src/application/maintenance/CertbotPort.js';
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

function buildWorld(overrides?: {
  facts?: Partial<SystemFacts>;
  manageAptSources?: boolean;
  quotaFs?: string;
  rutorrentPin?: 'none';
  letsencrypt?: { domain: string; email: string; acmeUrl?: string };
}): World {
  const packages = new FakePackages();
  const host = new FakeInstallHost();
  const systemd = new FakeSystemd();
  const checks = new FakeConfigChecks();
  const pki = new FakeVpnPki();
  const ipset = new FakeIpset();
  const certbot = new FakeCertbot(host);
  const ctx: InstallerContext = {
    packages,
    files: host,
    systemd,
    checks,
    host,
    ipset,
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
      ...(overrides?.quotaFs !== undefined && { quotaFs: overrides.quotaFs }),
      ...(overrides?.letsencrypt !== undefined && { letsencrypt: overrides.letsencrypt }),
      workerEnv: new Map([['KOBOX_DB', '/var/lib/kobox/kobox.db']]),
    },
  };
  return { packages, host, systemd, checks, pki, ipset, certbot, installers: buildInstallers(ctx) };
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
    expect(world.host.dirs.get('/var/lib/kobox')).toBe('0700');
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
    expect(world.systemd.log).toContain('daemon-reload');
    expect(world.systemd.log).toContain('enable-now kobox-worker');
    // boot oneshot is enabled but NOT started: no rules file exists yet
    expect(world.systemd.log).toContain('enable kobox-firewall');
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
  it('should_install_render_the_vhost_and_seed_an_empty_htpasswd_once', async () => {
    await installer(world, 'nginx').install();

    expect(world.packages.installed).toEqual(
      expect.arrayContaining(['nginx', 'php-fpm', 'ssl-cert']),
    );
    expect(world.host.contentAt('/etc/nginx/conf.d/kobox.conf')).toContain('listen 8189 ssl');
    expect(world.host.contentAt('/etc/nginx/kobox.htpasswd')).toBe('');
    expect(world.systemd.log).toContain('enable-now nginx');
  });

  it('should_never_overwrite_an_existing_htpasswd', async () => {
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

    expect(world.host.contentAt('/etc/nginx/kobox.htpasswd')).toBe('alice:$hash');
  });

  it('should_roll_back_the_vhost_when_nginx_t_fails', async () => {
    world.checks.failNginx('unexpected token');

    await expect(installer(world, 'nginx').install()).rejects.toThrow(InstallGuardError);

    expect(world.host.contentAt('/etc/nginx/conf.d/kobox.conf')).toBeUndefined();
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

describe('fail2ban installer', () => {
  it('should_install_and_enable_the_service', async () => {
    await installer(world, 'fail2ban').install();

    expect(world.packages.installed).toContain('fail2ban');
    expect(world.systemd.log).toContain('enable-now fail2ban');
  });
});
