import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Username } from '../../../../src/domain/user/Username.js';
import { describe, expect, it } from 'vitest';
import {
  InvalidWorkerEnvError,
  renderAptSources,
  renderBindLocal,
  renderBindOptions,
  renderCertbotDeployHook,
  renderDnscryptConfig,
  renderDnscryptSocketDropIn,
  renderFirewallBootUnit,
  renderNfsConf,
  renderNfsExports,
  renderNextcloudPhp,
  rutorrentProfilesDir,
  rutorrentUserConfigDir,
  rutorrentUserConfigsDir,
  RUTORRENT_OWN_CONFIG,
  renderNanomonUnit,
  renderNextcloudSite,
  renderNginxVhost,
  isWorkerOnlyEnv,
  renderPortalEnv,
  renderPortalUnit,
  renderRutorrentConfig,
  renderRutorrentPlugins,
  renderRutorrentPhpPool,
  renderQuotaGauge,
  renderRutorrentQuotaAnswer,
  renderRutorrentRatioOffer,
  renderRutorrentDefaultTheme,
  renderShellinaboxDefault,
  renderSmbConf,
  renderRutorrentUserConfig,
  renderRutorrentUsersInclude,
  renderSshdDropin,
  renderSysctlTweaks,
  renderWorkerEnv,
  renderWorkerUnit,
} from '../../../../src/domain/installation/rendering.js';
import { PHP_SETTINGS } from '../../../../src/domain/installation/platform.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/installation');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

describe('installation rendering', () => {
  it('should_render_the_worker_unit_golden', () => {
    const file = renderWorkerUnit({
      nodeBin: '/usr/bin/node',
      workerMain: '/opt/kobox/current/dist/interfaces/worker/main.js',
    });
    expect(file.path).toBe('/etc/systemd/system/kobox-worker.service');
    expect(file.mode).toBe('0644');
    // the watchdog replacement: a restart burst (upgrade + rollback) must
    // never leave the worker permanently dead on the start-rate limit
    expect(file.content).toContain('StartLimitIntervalSec=0');
    expectGolden('kobox-worker.service.golden', file.content);
  });

  it('should_serve_rutorrents_own_entry_point', () => {
    // ruTorrent 5.x ships index.html; 4.x shipped index.php. Naming only the
    // php one makes nginx fall through to a directory listing and answer 403 on
    // the very first visit, which is what a real install did.
    const conf = renderNginxVhost({ portalPort: 8189 }).content;

    expect(conf).toContain('index index.html index.php;');
  });

  // https://box/ is what people type: the portal answers there too, and 8189
  // stays for the download clients and the habits carried over from MySB
  it('should_serve_the_portal_on_the_standard_https_port_as_well', () => {
    const conf = renderNginxVhost({ portalPort: 8189 }).content;
    const portalBlock = conf.slice(conf.indexOf('listen 8189 ssl;') - 200);

    expect(portalBlock).toMatch(/listen 8189 ssl;\n\s+listen 443 ssl;/);
  });

  it('should_send_plain_http_to_the_address_people_type', () => {
    const conf = renderNginxVhost({ portalPort: 8189 }).content;

    expect(conf).toContain('return 301 https://$host$request_uri;');
  });

  // ruTorrent creates a member's profile folders with $profileMask, 0777 when
  // unset: everybody on the box could rewrite another member's settings
  it('should_keep_rutorrent_profiles_to_their_member_and_the_web_server', () => {
    const conf = renderRutorrentConfig().content;

    expect(conf).toContain('$profileMask = 0770;');
  });

  // dump needs dumptorrent, which no Debian release packages: left on, it is
  // an error at every load for a plugin nobody can use
  it('should_switch_off_the_plugins_this_box_cannot_run_and_keep_the_default_rights', () => {
    const file = renderRutorrentPlugins();

    expect(file.path).toBe('/var/www/rutorrent/conf/plugins.ini');
    expect(file.content).toContain('[dump]\nenabled = no');
    // retrackers can add public trackers to a private torrent; extsearch
    // searches public sites
    for (const plugin of ['retrackers', 'extsearch']) {
      expect(file.content, plugin).toContain(`[${plugin}]\nenabled = no`);
    }
    // a plugins.ini replaces ruTorrent's whole: its default rights come along
    expect(file.content).toContain('[default]\nenabled = user-defined');
    expectGolden('rutorrent-plugins.ini.golden', file.content);
  });

  it('should_turn_http2_on_with_the_directive_nginx_1_26_expects', () => {
    // `listen ... http2` is deprecated since nginx 1.25 and warns on every reload
    const conf = renderNginxVhost({ portalPort: 8189 }).content;

    expect(conf).toContain('listen 8189 ssl;');
    expect(conf).toContain('http2 on;');
    expect(conf).not.toContain('ssl http2;');
  });

  it('should_hand_php_to_the_php_fpm_of_the_target_release', () => {
    const socket = 'fastcgi_pass unix:/run/php/php8.4-fpm.sock;';

    // ruTorrent's PHP goes to each member's own pool; Nextcloud keeps the
    // release's shared one
    expect(renderNextcloudSite().content).toContain(socket);
  });

  // modHeadersAvailable tells Nextcloud the web server sends these, so it does
  // not: without them its admin page listed every one as missing
  it('should_send_the_security_headers_nextcloud_leaves_to_the_web_server', () => {
    const conf = renderNextcloudSite().content;

    for (const header of [
      'add_header Referrer-Policy "no-referrer" always;',
      'add_header X-Content-Type-Options "nosniff" always;',
      'add_header X-Frame-Options "SAMEORIGIN" always;',
      'add_header X-Permitted-Cross-Domain-Policies "none" always;',
      'add_header X-Robots-Tag "noindex, nofollow" always;',
      'add_header Strict-Transport-Security "max-age=15552000" always;',
      'fastcgi_hide_header X-Powered-By;',
    ]) {
      expect(conf, header).toContain(header);
    }
  });

  // browsers refuse a JavaScript module served as anything but JavaScript
  it('should_serve_javascript_modules_as_javascript', () => {
    expect(renderNextcloudSite().content).toMatch(
      /location ~ \\\.mjs\$ \{\s+default_type text\/javascript;/,
    );
  });

  // CalDAV, CardDAV and webfinger clients ask the root of the domain
  it('should_send_well_known_lookups_to_nextcloud', () => {
    const conf = renderNextcloudSite().content;

    expect(conf).toContain('location = /.well-known/carddav { return 301 /nextcloud/remote.php/dav/; }');
    expect(conf).toContain('location = /.well-known/caldav { return 301 /nextcloud/remote.php/dav/; }');
    expect(conf).toContain('location ^~ /.well-known/ { return 301 /nextcloud/index.php$request_uri; }');
  });

  it('should_let_nextcloud_clients_authenticate_themselves', () => {
    // the portal session stood in front of /nextcloud/: the desktop and
    // mobile apps send their own Nextcloud credentials and never got through.
    // The only check left there is the one that never refuses.
    const conf = renderNextcloudSite().content;
    const checks = [...conf.matchAll(/auth_request (\S+);/g)].map((match) => match[1]);
    expect(checks).toEqual(['/internal/auth/session']);
  });

  // a member signed in to the portal opens Nextcloud already signed in
  it('should_hand_nextcloud_the_member_signed_in_to_the_portal', () => {
    const conf = renderNextcloudSite().content;

    expect(conf).toContain('auth_request_set $kobox_portal_user $upstream_http_x_kobox_user;');
    expect(conf).toContain('fastcgi_param KOBOX_PORTAL_USER $kobox_portal_user;');
  });

  // Nextcloud believes this name without checking it: no other line may set
  // it, and fastcgi_params never does (a client only reaches HTTP_* names)
  it('should_set_the_portal_user_for_nextcloud_in_one_place_only', () => {
    const conf = renderNextcloudSite().content;

    expect(conf.match(/KOBOX_PORTAL_USER/g)).toHaveLength(1);
  });

  it('should_route_the_session_check_to_the_portal_inside_the_vhost', () => {
    const vhost = renderNginxVhost({ portalPort: 8189 }).content;

    expect(vhost).toMatch(/location = \/internal\/auth\/session \{\n\s+internal;\n\s+proxy_pass http:\/\/127\.0\.0\.1:\d+\/internal\/auth\/session;/);
  });

  it('should_hand_the_path_after_a_php_script_to_nextcloud', () => {
    // remote.php/dav/... (every app) and index.php/login reached no PHP:
    // only URIs ending in .php were passed on, the rest got 404 or 405
    const conf = renderNextcloudSite().content;
    expect(conf).toContain('location ~ \\.php(?:$|/) {');
    expect(conf).toContain('fastcgi_split_path_info ^(.+?\\.php)(/.*)$;');
    expect(conf).toContain('fastcgi_param PATH_INFO $path_info;');
    expect(conf).toContain('location ~ ^/nextcloud/(?:build|tests|config|lib|3rdparty|templates|data)(?:$|/) {');
    expectGolden('nextcloud.conf.golden', conf);
  });

  // ruTorrent ran as the web server, which is in every member's group for
  // Nextcloud: a flaw in it read every member's files. Each member now has a
  // PHP pool of their own, running as them
  it('should_give_each_member_a_rutorrent_php_pool_running_as_them', () => {
    const pool = renderRutorrentPhpPool('alice');

    expect(pool.path).toBe('/etc/php/8.4/fpm/pool.d/kobox-ru-alice.conf');
    for (const line of [
      '[kobox-ru-alice]',
      'user = alice',
      'group = alice',
      'listen = /run/php/kobox-ru-alice.sock',
      'listen.owner = www-data',
      'listen.mode = 0660',
      'pm = ondemand',
    ]) {
      expect(pool.content, line).toContain(`${line}\n`);
    }
  });

  it('should_hand_rutorrents_php_to_the_pool_of_the_member_signed_in', () => {
    const conf = renderNginxVhost({ portalPort: 8189 }).content;
    const rutorrentPhp = conf.slice(conf.indexOf('location ~ ^/ru/(.+\\.php)$'));

    expect(rutorrentPhp).toContain('fastcgi_pass unix:/run/php/kobox-ru-$kobox_user.sock;');
    expect(conf).not.toContain(`fastcgi_param SCRIPT_FILENAME /usr/local/share/kobox/rutorrent-quota.php;\n        fastcgi_param REMOTE_USER $kobox_user;\n        fastcgi_pass unix:/run/php/php8.4-fpm.sock;`);
  });

  it('should_refuse_rutorrents_private_directories_before_any_other_ru_location', () => {
    // share/ holds every member's profile (uploaded .torrent files carry
    // private-tracker passkeys), conf/ the per-user wiring, tests/ dev code.
    // Served by the /ru/ alias, any logged-in member could read another's.
    // The deny must precede the .php regex: nginx keeps the first regex match.
    const conf = renderNginxVhost({ portalPort: 8189 }).content;
    const deny = 'location ~ ^/ru/(share|conf|tests)/ {\n        deny all;\n    }';

    expect(conf).toContain(deny);
    expect(conf.indexOf(deny)).toBeLessThan(conf.indexOf('location ~ ^/ru/(.+\\.php)$'));
  });


  it('should_render_the_portal_systemd_unit_golden', () => {
    const file = renderPortalUnit({
      nodeBin: '/usr/bin/node',
      portalMain: '/opt/kobox/current/kobox/dist/interfaces/http/main.js',
    });
    expect(file.path).toBe('/etc/systemd/system/kobox-portal.service');
    // runs non-root under the portal identity
    expect(file.content).toContain('User=kobox-portal');
    expect(file.content).toContain('Group=kobox-portal');
    // journald identifier the fail2ban portal jail keys on
    expect(file.content).toContain('SyslogIdentifier=kobox-portal');
    // its OWN env file — never the worker's, which holds the secrets
    expect(file.content).toContain('EnvironmentFile=-/etc/kobox/portal.env');
    expect(file.content).not.toContain('worker.env');
    expect(file.content).toContain(
      'ExecStart=/usr/bin/node /opt/kobox/current/kobox/dist/interfaces/http/main.js',
    );
    expectGolden('kobox-portal.service.golden', file.content);
  });

  it('should_render_the_firewall_boot_unit_golden_guarded_by_the_rules_file', () => {
    const file = renderFirewallBootUnit();
    expect(file.path).toBe('/etc/systemd/system/kobox-firewall.service');
    // Phase 3 debt #1: the persisted ruleset survives reboot, but only when
    // an apply already produced it — the Condition keeps first boot clean.
    expect(file.content).toContain('ConditionPathExists=/etc/kobox/firewall.rules');
    expect(file.content).toContain('iptables-restore /etc/kobox/firewall.rules');
    expectGolden('kobox-firewall.service.golden', file.content);
  });

  it('should_render_worker_env_sorted_and_reject_unsafe_entries', () => {
    const file = renderWorkerEnv(
      new Map([
        ['KOBOX_STRICT_SERVICES', '1'],
        ['KOBOX_DB', '/var/lib/kobox/kobox.db'],
      ]),
    );
    expect(file.path).toBe('/etc/kobox/worker.env');
    expect(file.mode).toBe('0600');
    expectGolden('worker.env.golden', file.content);

    expect(() => renderWorkerEnv(new Map([['bad-key', 'x']]))).toThrow(InvalidWorkerEnvError);
    expect(() => renderWorkerEnv(new Map([['KOBOX_X', 'a\nb']]))).toThrow(InvalidWorkerEnvError);
  });

  it('should_render_portal_env_without_any_worker_only_secret_golden', () => {
    const snapshot = new Map([
      ['KOBOX_DB', '/var/lib/kobox/kobox.db'],
      ['KOBOX_PORTAL_HTTP_PORT', '8190'],
      // every secret the root worker alone acts on
      ['KOBOX_IBLOCKLIST_USER', 'the-list-user'],
      ['KOBOX_IBLOCKLIST_PIN', 'the-list-pin'],
      ['KOBOX_NTFY_URL', 'https://ntfy.example.net/secret-topic'],
      ['KOBOX_DISCORD_WEBHOOK', 'https://discord.example/api/webhooks/xyz'],
      // convention-matched: a secret added later is withheld by default
      ['KOBOX_FUTURE_TOKEN', 'not-yet-invented'],
      // and so is one a retired feature left behind in an upgraded box's
      // worker.env: nothing reads it any more, and it still never reaches the
      // portal
      ['KOBOX_ARIA2_RPC_SECRET', 'the-rpc-secret'],
    ]);

    const file = renderPortalEnv(snapshot);

    expect(file.path).toBe('/etc/kobox/portal.env');
    // readable by the non-root portal identity, nobody else
    expect(file.mode).toBe('0640');
    expect(file.owner).toBe('root');
    expect(file.group).toBe('kobox-portal');
    // the plain config it needs survives
    expect(file.content).toContain('KOBOX_DB=/var/lib/kobox/kobox.db');
    expect(file.content).toContain('KOBOX_PORTAL_HTTP_PORT=8190');
    // not one secret VALUE reaches the file
    for (const secret of [
      'the-rpc-secret',
      'the-list-user',
      'the-list-pin',
      'secret-topic',
      'webhooks/xyz',
      'not-yet-invented',
    ]) {
      expect(file.content, secret).not.toContain(secret);
    }
    expectGolden('portal.env.golden', file.content);

    // the worker still gets everything — the split withholds, it never drops
    expect(renderWorkerEnv(snapshot).content).toContain('KOBOX_IBLOCKLIST_PIN=the-list-pin');
  });

  it('should_classify_worker_only_env_keys_by_name_and_convention', () => {
    for (const key of [
      'KOBOX_IBLOCKLIST_PIN',
      'KOBOX_NTFY_URL',
      'KOBOX_SOMETHING_TOKEN',
      'KOBOX_SOMETHING_PASSWORD',
    ]) {
      expect(isWorkerOnlyEnv(key), key).toBe(true);
    }
    // plain config the portal legitimately needs must NOT be filtered
    for (const key of [
      'KOBOX_DB',
      'KOBOX_PORTAL_HTTP_PORT',
      'KOBOX_LE_DOMAIN',
      'KOBOX_VPN_PROFILES_DIR',
      'KOBOX_NANOMON_SHA256',
    ]) {
      expect(isWorkerOnlyEnv(key), key).toBe(false);
    }
  });

  // the firewall rules are IPv4 only: an sshd answering on IPv6 would be open
  // to every address the day the box gets a public IPv6 one
  it('should_have_sshd_answer_on_ipv4_only', () => {
    expect(renderSshdDropin(22).content).toContain('AddressFamily inet\n');
  });

  it('should_render_the_sshd_dropin_without_a_port_line_on_the_default_port', () => {
    const file = renderSshdDropin(22);
    expect(file.path).toBe('/etc/ssh/sshd_config.d/90-kobox.conf');
    expect(file.content).not.toContain('Port ');
    expect(file.content).toContain('PermitRootLogin prohibit-password');
    expectGolden('sshd_config.d-90-kobox.conf.golden', file.content);
  });

  it('should_emit_a_port_line_only_when_the_ssh_port_differs', () => {
    expect(renderSshdDropin(2222).content).toContain('Port 2222');
  });

  it('should_render_the_sysctl_tweaks_golden', () => {
    const file = renderSysctlTweaks();
    expect(file.path).toBe('/etc/sysctl.d/90-kobox.conf');
    expectGolden('sysctl.d-90-kobox.conf.golden', file.content);
  });

  it('should_render_the_trixie_apt_sources_in_deb822', () => {
    const sources = renderAptSources().find(
      (file) => file.path === '/etc/apt/sources.list.d/debian.sources',
    );

    expect(sources?.content).toContain('Suites: trixie trixie-updates');
    expect(sources?.content).toContain('Suites: trixie-security');
    // unrar, the only one that opens RAR5 archives, lives in non-free
    expect(sources?.content).toContain('Components: main contrib non-free non-free-firmware');
    expectGolden('debian.sources.golden', sources?.content ?? '');
  });

  it('should_empty_the_legacy_sources_list_so_apt_never_sees_a_suite_twice', () => {
    // a box upgraded in place still lists the previous release there
    const legacy = renderAptSources().find((file) => file.path === '/etc/apt/sources.list');

    expect(legacy?.content).not.toMatch(/^deb /m);
    expectGolden('sources.list.golden', legacy?.content ?? '');
  });

  it('should_render_a_session_authed_nginx_vhost_golden', () => {
    const file = renderNginxVhost({ portalPort: 8189 });
    expect(file.path).toBe('/etc/nginx/conf.d/kobox.conf');
    expect(file.content).toContain('listen 8189 ssl');
    // Phase 6: the shared Basic Auth is gone; the SSR portal owns auth
    expect(file.content).not.toContain('auth_basic');
    expect(file.content).not.toContain('kobox.htpasswd');
    expect(file.content).toContain('proxy_pass http://127.0.0.1:8190');
    expect(file.content).toContain('auth_request /internal/auth;');
    // /ru is gated and forwards the authenticated user to php-fpm
    expect(file.content).toContain('fastcgi_param REMOTE_USER $kobox_user;');
    // per-user SCGI mounts are pulled from the rendered include dir
    expect(file.content).toContain('include /etc/nginx/kobox.d/*.conf;');
    // NanoMon monitoring is admin-gated and proxied on loopback
    expect(file.content).toContain('location /monitoring/ {');
    expect(file.content).toContain('proxy_pass http://127.0.0.1:8191/;');
    // the ACME webroot is always served on :80 so certbot can validate
    // before any certificate exists
    expect(file.content).toContain('listen 80;');
    expect(file.content).toContain('location /.well-known/acme-challenge/');
    expect(file.content).toContain('root /var/www/acme;');
    expect(file.content).toContain('ssl-cert-snakeoil');
    expectGolden('nginx-kobox.conf.golden', file.content);
  });

  it('should_render_per_user_rpc_scgi_mounts_golden', () => {
    const file = renderRutorrentUsersInclude([
      { username: 'alice', scgiPort: 51101 },
      { username: 'bob', scgiPort: 51102 },
    ]);
    expect(file.path).toBe('/etc/nginx/kobox.d/rutorrent-users.conf');
    // legacy parity: uppercase /RPC-<USER> mount per user
    expect(file.content).toContain('location = /RPC-ALICE');
    expect(file.content).toContain('scgi_pass 127.0.0.1:51101;');
    expect(file.content).toContain('location = /RPC-BOB');
    expect(file.content).toContain('scgi_pass 127.0.0.1:51102;');
    // each mount is gated to its owner (or an admin) by the portal
    expect(file.content).toContain('auth_request /internal/auth/rpc;');
    expectGolden('nginx-rutorrent-users.conf.golden', file.content);
  });

  it('should_render_an_empty_rpc_include_when_no_users_exist', () => {
    const file = renderRutorrentUsersInclude([]);
    expect(file.content).not.toContain('location = /RPC-');
    expect(file.content).toContain('KoBox-managed');
  });

  it('should_render_a_per_user_rutorrent_config_golden', () => {
    const file = renderRutorrentUserConfig({ username: 'alice', scgiPort: 51101 });
    expect(file.path).toBe('/var/www/rutorrent/conf/users/alice/config.php');
    expect(file.content).toContain('$scgi_port = 51101;');
    expect(file.content).toContain("$XMLRPCMountPoint = '/RPC-ALICE';");
    expectGolden('nginx-rutorrent-user-alice.php.golden', file.content);
  });

  // ruTorrent runs as the web server, a member of every member's group: bounded
  // by /home alone, its folder picker listed another member's downloads
  // ruTorrent now runs as the member: a config only the web server could read
  // left it on the default port, and it lost its rTorrent
  it('should_let_the_member_and_only_them_read_their_rutorrent_config', () => {
    const file = renderRutorrentUserConfig({ username: 'alice', scgiPort: 51101 });

    expect([file.owner, file.group, file.mode]).toEqual(['root', 'alice', '0640']);
  });

  it('should_let_every_members_rutorrent_read_the_shared_config', () => {
    const file = renderRutorrentConfig();

    expect([file.owner, file.group, file.mode]).toEqual(['root', 'root', '0644']);
    expect(file.content).not.toMatch(/pass|secret|key/i);
  });

  it('should_keep_a_members_rutorrent_inside_their_own_home', () => {
    const file = renderRutorrentUserConfig({ username: 'alice', scgiPort: 51101 });

    expect(file.content).toContain("$topDirectory = '/home/alice/';");
  });

  it('should_switch_to_the_lets_encrypt_paths_once_a_cert_was_issued', () => {
    const file = renderNginxVhost({
      portalPort: 8189,
      letsencrypt: { domain: 'box.example.org' },
    });
    expect(file.content).toContain('server_name box.example.org;');
    expect(file.content).toContain(
      'ssl_certificate /etc/letsencrypt/live/box.example.org/fullchain.pem;',
    );
    expect(file.content).toContain(
      'ssl_certificate_key /etc/letsencrypt/live/box.example.org/privkey.pem;',
    );
    expect(file.content).not.toContain('snakeoil');
    expectGolden('nginx-kobox.conf-letsencrypt.golden', file.content);
  });

  it('should_render_the_certbot_deploy_hook_golden', () => {
    const file = renderCertbotDeployHook();
    expect(file.path).toBe('/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx');
    expect(file.mode).toBe('0755');
    expect(file.content.startsWith('#!/bin/sh\n')).toBe(true);
    expect(file.content).toContain('systemctl reload nginx');
    expectGolden('certbot-deploy-hook.golden', file.content);
  });

  // ruTorrent ships eight groups named ratio0 to ratio7, all alike: members got
  // groups that say what they do, and only those who never changed their own
  it('should_offer_ratio_groups_that_say_what_they_do_only_over_untouched_defaults', () => {
    const file = renderRutorrentRatioOffer();
    const script = file.content;

    expect(file.path).toBe('/usr/local/share/kobox/rutorrent-ratios.php');
    expect(file.mode).toBe('0644');
    for (const name of [
      'Privé : ratio 1 ou 3 jours',
      'Privé exigeant : ratio 2 ou 7 jours',
      'Public : ratio 1',
      'Court : 24 h',
    ]) {
      expect(script).toContain(`'name' => '${name}'`);
    }
    expect(script).toContain("'min' => 100, 'max' => 100, 'upload' => 0, 'time' => 72");
    // every group stops the torrent: nothing is ever erased on its own
    expect(script).not.toMatch(/RAT_ERASE/);
    // a member who changed any group keeps theirs
    expect(script).toContain("\$group['name'] === 'ratio' . \$i");
    expect(script).toContain('if (!$untouched) {\n    exit(0);');
    // a ruTorrent release without its ratio plugin: nothing to offer, no failure
    expect(script).toContain("if (!is_file('/var/www/rutorrent/plugins/ratio/ratio.php')) {\n  exit(0);\n}");
    expectGolden('rutorrent-ratios.php.golden', script);
  });

  // ruTorrent's light default sat oddly inside the dark portal: MaterialDesign
  // is the default, and a member who picked a theme in its settings keeps theirs
  it('should_make_material_design_the_default_rutorrent_theme', () => {
    const file = renderRutorrentDefaultTheme();

    expect(file.path).toBe('/var/www/rutorrent/plugins/theme/conf.local.php');
    expect(file.content).toContain('$defaultTheme = "MaterialDesign";');
    expectGolden('rutorrent-theme.conf.local.php.golden', file.content);
  });

  // ruTorrent's disk meter showed the whole disk: it reads, for each member,
  // their quota in its own format, total and free, from their profile folder
  it('should_hand_the_disk_meter_a_members_quota_in_its_own_format', () => {
    const gib = 1024 ** 3;
    const file = renderQuotaGauge('alice', 37 * gib, 412 * gib);

    expect(file.path).toBe('/var/lib/rutorrent/users/alice/kobox-quota.json');
    expect(JSON.parse(file.content)).toEqual({ total: 412 * gib, free: 375 * gib });
    // read by the web server for that member only
    expect([file.mode, file.owner, file.group]).toEqual(['0640', 'www-data', 'alice']);
  });

  it('should_never_show_less_than_nothing_free_to_a_member_over_quota', () => {
    const file = renderQuotaGauge('alice', 500, 400);

    expect(JSON.parse(file.content)).toEqual({ total: 400, free: 0 });
  });

  it('should_answer_the_disk_meter_from_the_members_own_gauge', () => {
    const file = renderRutorrentQuotaAnswer();

    expect(file.path).toBe('/usr/local/share/kobox/rutorrent-quota.php');
    expect(file.content).toContain("FileUtil::getProfilePath() . '/kobox-quota.json'");
    expect(file.content).toContain("CachedEcho::send($answer, 'application/json');");
    expectGolden('rutorrent-quota.php.golden', file.content);
  });

  it('should_route_the_disk_meter_to_the_quota_answer_behind_the_session_check', () => {
    const vhost = renderNginxVhost({ portalPort: 8189 }).content;
    const block = /location = \/ru\/plugins\/diskspace\/action\.php \{[^}]*\}/.exec(vhost)?.[0] ?? '';

    expect(block).toContain('auth_request /internal/auth;');
    expect(block).toContain('fastcgi_param SCRIPT_FILENAME /usr/local/share/kobox/rutorrent-quota.php;');
    expect(block).toContain('fastcgi_param REMOTE_USER $kobox_user;');
  });

  it('should_render_the_global_rutorrent_config_golden', () => {
    const file = renderRutorrentConfig();
    // ruTorrent's config.php loads it last: KoBox's overrides, nothing more
    expect(file.path).toBe('/var/www/rutorrent/conf/config.local.php');
    expectGolden('rutorrent-config.php.golden', file.content);
  });

  it('should_keep_rutorrent_profiles_outside_the_served_tree', () => {
    // ruTorrent's own advice: the nginx deny is one guard, a profile path no
    // web server can reach is the one nothing else has to be right for.
    const file = renderRutorrentConfig();

    expect(file.content).toContain("$profilePath = '/var/lib/rutorrent';");
  });

  it('should_render_nfs_exports_per_user_and_trusted_address_golden', () => {
    const file = renderNfsExports([
      {
        username: Username.parse('alice'),
        ids: { uid: 1001, gid: 1001 },
        clients: ['10.0.0.2', '10.0.1.2', '10.0.2.2', '203.0.113.9'],
      },
      { username: Username.parse('bob'), ids: { uid: 1002, gid: 1002 }, clients: [] },
    ]);
    expect(file.path).toBe('/etc/exports.d/kobox.exports');
    // one line per client of a member's home, and whatever a client writes
    // belongs to the member, whatever uids that machine uses
    expect(file.content).toContain(
      '/home/alice 10.0.1.2(rw,sync,no_subtree_check,all_squash,anonuid=1001,anongid=1001)',
    );
    expect(file.content).toContain(
      '/home/alice 203.0.113.9(rw,sync,no_subtree_check,all_squash,anonuid=1001,anongid=1001)',
    );
    // a member with no client exports to nobody (no wildcard)
    expect(file.content).not.toContain('/home/bob ');
    expectGolden('nfs-kobox.exports.golden', file.content);
  });

  it('should_render_the_samba_config_golden', () => {
    const file = renderSmbConf();
    expect(file.path).toBe('/etc/samba/smb.conf');
    expect(file.content).toContain('security = user');
    expect(file.content).toContain('[homes]');
    expectGolden('smb.conf.golden', file.content);
  });

  it('should_render_shellinabox_bound_to_localhost_golden', () => {
    const file = renderShellinaboxDefault();
    expect(file.path).toBe('/etc/default/shellinabox');
    // hardened: localhost only, behind the portal's admin-gated proxy
    expect(file.content).toContain('--localhost-only');
    expect(file.content).toContain('127.0.0.1');
    expectGolden('shellinabox.default.golden', file.content);
  });

  it('should_render_the_nanomon_unit_non_root_on_loopback_golden', () => {
    const file = renderNanomonUnit();
    expect(file.path).toBe('/etc/systemd/system/kobox-nanomon.service');
    // non-root, read-only, loopback-bound
    expect(file.content).toContain('User=nanomon');
    expect(file.content).toContain('NANOMON_BIND=127.0.0.1');
    expect(file.content).toContain('ProtectSystem=strict');
    expectGolden('kobox-nanomon.service.golden', file.content);
  });

  it('should_render_bind_files_wired_to_the_phase2_blacklist_zones', () => {
    const local = renderBindLocal();
    expect(local.path).toBe('/etc/bind/named.conf.local');
    expect(local.content).toContain('include "/etc/bind/kobox.zones.blacklists";');
    expectGolden('named.conf.local.golden', local.content);

    const options = renderBindOptions({ dnscryptForwarder: true });
    expect(options.path).toBe('/etc/bind/named.conf.options');
    expect(options.content).toContain('port 52');
    expectGolden('named.conf.options.golden', options.content);
  });

  it('should_render_bind_with_direct_recursion_when_dnscrypt_is_unavailable', () => {
    // where Debian does not package dnscrypt-proxy, bind must still resolve
    // (forward-only to a dead port would break the whole box's DNS)
    const options = renderBindOptions({ dnscryptForwarder: false });
    expect(options.content).not.toContain('forward only');
    expect(options.content).not.toContain('port 52');
    expectGolden('named.conf.options-direct.golden', options.content);
  });

  it('should_render_dnscrypt_for_socket_activation_with_the_phase2_blocked_names_file', () => {
    const file = renderDnscryptConfig();
    expect(file.path).toBe('/etc/dnscrypt-proxy/dnscrypt-proxy.toml');
    // systemd binds the port: listeners of its own would fail as non-root
    expect(file.content).toContain('listen_addresses = []');
    expect(file.content).toContain("blocked_names_file = '/etc/dnscrypt-proxy/blocked-names.txt'");
    expectGolden('dnscrypt-proxy.toml.golden', file.content);
  });

  it('should_bind_the_dnscrypt_socket_where_bind_forwards', () => {
    const file = renderDnscryptSocketDropIn();
    expect(file.path).toBe('/etc/systemd/system/dnscrypt-proxy.socket.d/90-kobox.conf');
    expect(file.content).toContain('ListenDatagram=127.0.0.1:52');
    expectGolden('dnscrypt-proxy.socket.dropin.golden', file.content);
  });
});

describe('installation rendering: who may read and run each file', () => {
  const alice = { username: 'alice', scgiPort: 5001 };

  it.each([
    ['worker unit', () => renderWorkerUnit({ nodeBin: '/usr/bin/node', workerMain: '/opt/w.js' }), '0644', 'root', 'root'],
    ['portal unit', () => renderPortalUnit({ nodeBin: '/usr/bin/node', portalMain: '/opt/p.js' }), '0644', 'root', 'root'],
    ['nanomon unit', () => renderNanomonUnit(), '0644', 'root', 'root'],
    ['firewall unit', () => renderFirewallBootUnit(), '0644', 'root', 'root'],
    ['worker env', () => renderWorkerEnv(new Map()), '0600', 'root', 'root'],
    ['sshd drop-in', () => renderSshdDropin(22), '0600', 'root', 'root'],
    ['sysctl tweaks', () => renderSysctlTweaks(), '0644', 'root', 'root'],
    ['nginx vhost', () => renderNginxVhost({ portalPort: 8189 }), '0644', 'root', 'root'],
    ['nfs config', () => renderNfsConf(), '0644', 'root', 'root'],
    ['nfs exports', () => renderNfsExports([]), '0644', 'root', 'root'],
    ['samba', () => renderSmbConf(), '0644', 'root', 'root'],
    ['shellinabox', () => renderShellinaboxDefault(), '0644', 'root', 'root'],
    ['rpc include', () => renderRutorrentUsersInclude([alice]), '0644', 'root', 'root'],
    ['member rutorrent config', () => renderRutorrentUserConfig(alice), '0640', 'root', 'alice'],
    ['member php pool', () => renderRutorrentPhpPool('alice'), '0644', 'root', 'root'],
    ['nextcloud site', () => renderNextcloudSite(), '0644', 'root', 'root'],
    ['certbot hook', () => renderCertbotDeployHook(), '0755', 'root', 'root'],
    ['quota answer', () => renderRutorrentQuotaAnswer(), '0644', 'root', 'root'],
    ['rutorrent config', () => renderRutorrentConfig(), '0644', 'root', 'root'],
    ['ratio offer', () => renderRutorrentRatioOffer(), '0644', 'root', 'root'],
    ['default theme', () => renderRutorrentDefaultTheme(), '0644', 'root', 'root'],
    ['plugins', () => renderRutorrentPlugins(), '0644', 'root', 'root'],
    ['bind local', () => renderBindLocal(), '0644', 'root', 'bind'],
    ['bind options', () => renderBindOptions({ dnscryptForwarder: true }), '0644', 'root', 'bind'],
    ['dnscrypt socket', () => renderDnscryptSocketDropIn(), '0644', 'root', 'root'],
    ['dnscrypt config', () => renderDnscryptConfig(), '0644', 'root', 'root'],
  ])('should_install_the_%s_with_the_expected_permissions', (_name, render, mode, owner, group) => {
    const file = render();
    expect([file.mode, file.owner, file.group]).toEqual([mode, owner, group]);
  });

  it('should_write_every_apt_source_file_root_owned_and_world_readable', () => {
    for (const file of renderAptSources()) {
      expect([file.mode, file.owner, file.group], file.path).toEqual(['0644', 'root', 'root']);
    }
  });

  it('should_install_every_nextcloud_php_setting_root_owned_and_world_readable', () => {
    for (const file of renderNextcloudPhp()) {
      expect([file.mode, file.owner, file.group], file.path).toEqual(['0644', 'root', 'root']);
    }
  });

  it.each([
    ['worker unit', () => renderWorkerUnit({ nodeBin: '/usr/bin/node', workerMain: '/opt/w.js' }), '/etc/systemd/system/kobox-worker.service'],
    ['nanomon unit', () => renderNanomonUnit(), '/etc/systemd/system/kobox-nanomon.service'],
    ['nginx vhost', () => renderNginxVhost({ portalPort: 8189 }), '/etc/nginx/conf.d/kobox.conf'],
    ['nfs exports', () => renderNfsExports([]), '/etc/exports.d/kobox.exports'],
    ['samba', () => renderSmbConf(), '/etc/samba/smb.conf'],
    ['shellinabox', () => renderShellinaboxDefault(), '/etc/default/shellinabox'],
    ['rpc include', () => renderRutorrentUsersInclude([]), '/etc/nginx/kobox.d/rutorrent-users.conf'],
    ['nextcloud site', () => renderNextcloudSite(), '/etc/nginx/kobox.d/nextcloud.conf'],
    ['certbot hook', () => renderCertbotDeployHook(), '/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx'],
    ['ratio offer', () => renderRutorrentRatioOffer(), '/usr/local/share/kobox/rutorrent-ratios.php'],
    ['default theme', () => renderRutorrentDefaultTheme(), '/var/www/rutorrent/plugins/theme/conf.local.php'],
    ['plugins', () => renderRutorrentPlugins(), '/var/www/rutorrent/conf/plugins.ini'],
    ['bind local', () => renderBindLocal(), '/etc/bind/named.conf.local'],
    ['bind options', () => renderBindOptions({ dnscryptForwarder: false }), '/etc/bind/named.conf.options'],
    ['dnscrypt socket', () => renderDnscryptSocketDropIn(), '/etc/systemd/system/dnscrypt-proxy.socket.d/90-kobox.conf'],
    ['dnscrypt config', () => renderDnscryptConfig(), '/etc/dnscrypt-proxy/dnscrypt-proxy.toml'],
  ])('should_write_the_%s_where_its_consumer_reads_it', (_name, render, path) => {
    expect(render().path).toBe(path);
  });
});

describe('installation rendering: files without a golden', () => {
  it('should_pin_nfs_mountd_to_the_port_the_firewall_opens', () => {
    const file = renderNfsConf();
    expect(file.path).toBe('/etc/nfs.conf.d/kobox.conf');
    expect(file.content.split('\n').slice(1)).toEqual(['[mountd]', 'port=32767', '']);
  });

  it('should_give_php_the_memory_and_cache_nextcloud_asks_for', () => {
    const [fpm, cli, pool] = renderNextcloudPhp();
    expect(fpm?.path).toBe(PHP_SETTINGS.fpm);
    expect(fpm?.content.split('\n').slice(1)).toEqual([
      'memory_limit = 512M',
      'opcache.interned_strings_buffer = 16',
      '',
    ]);
    expect(cli?.path).toBe(PHP_SETTINGS.cli);
    expect(cli?.content.split('\n').slice(1)).toEqual(['memory_limit = 512M', 'apc.enable_cli = 1', '']);
    expect(pool?.path).toBe(PHP_SETTINGS.pool);
    expect(pool?.content.split('\n').slice(1)).toEqual(['[www]', 'clear_env = no', '']);
  });

  it('should_mark_php_ini_files_with_a_semicolon_comment_php_accepts', () => {
    // a `#` line is a syntax error in a php ini file
    for (const file of [...renderNextcloudPhp(), renderRutorrentPhpPool('alice')]) {
      expect(file.content.split('\n')[0], file.path).toBe(
        '; KoBox-managed \u2014 DO NOT EDIT (rendered declaratively).',
      );
    }
  });

  it('should_keep_each_members_rutorrent_config_and_profile_in_their_own_folder', () => {
    expect(rutorrentUserConfigsDir()).toBe('/var/www/rutorrent/conf/users');
    expect(rutorrentUserConfigDir('alice')).toBe('/var/www/rutorrent/conf/users/alice');
    expect(rutorrentProfilesDir()).toBe('/var/lib/rutorrent/users');
    expect(RUTORRENT_OWN_CONFIG).toBe('/var/www/rutorrent/conf/config.php');
  });
  it('should_let_the_web_server_reach_the_pool_and_keep_idle_members_cheap', () => {
    // nginx connects through the socket as www-data; ondemand with a short idle
    // timeout means a member who is not looking costs no process
    expect(renderRutorrentPhpPool('alice').content.split('\n').slice(5)).toEqual([
      'listen.owner = www-data',
      'listen.group = www-data',
      'listen.mode = 0660',
      'pm = ondemand',
      'pm.max_children = 4',
      'pm.process_idle_timeout = 30s',
      'clear_env = no',
      '',
    ]);
  });
});

describe('installation rendering: environment snapshots', () => {
  it('should_sort_entries_by_key_whatever_the_snapshot_order', () => {
    const file = renderWorkerEnv(
      new Map([
        ['KOBOX_C', '3'],
        ['KOBOX_A', '1'],
        ['KOBOX_B', '2'],
      ]),
    );
    expect(file.content.split('\n').slice(1)).toEqual(['KOBOX_A=1', 'KOBOX_B=2', 'KOBOX_C=3', '']);
  });

  it('should_accept_keys_of_capitals_digits_and_underscores_starting_with_a_capital', () => {
    const file = renderWorkerEnv(new Map([['K9_X', 'v']]));
    expect(file.content).toContain('\nK9_X=v\n');
    expect(renderWorkerEnv(new Map([['K', 'v']])).content).toContain('\nK=v\n');
  });

  it('should_refuse_a_key_that_systemd_would_misread', () => {
    for (const key of ['', '9KOBOX', '_KOBOX', 'kobox_db', 'KOBOX_db', 'KOBOX-DB', 'KOBOX DB', ' KOBOX', 'KOBOX=']) {
      expect(() => renderWorkerEnv(new Map([[key, 'v']])), key).toThrow(
        `invalid worker environment entry: key ${JSON.stringify(key)}`,
      );
      expect(() => renderPortalEnv(new Map([[key, 'v']])), key).toThrow(InvalidWorkerEnvError);
    }
  });

  it('should_refuse_a_value_that_would_smuggle_a_second_entry', () => {
    expect(() => renderWorkerEnv(new Map([['KOBOX_X', 'a\nKOBOX_Y=b']]))).toThrow(
      'invalid worker environment entry: value of KOBOX_X contains a newline',
    );
    expect(() => renderPortalEnv(new Map([['KOBOX_X', 'a\nb']]))).toThrow(InvalidWorkerEnvError);
  });

  it('should_validate_even_the_entries_the_portal_never_receives', () => {
    expect(() => renderPortalEnv(new Map([['KOBOX_X_SECRET', 'a\nb']]))).toThrow(InvalidWorkerEnvError);
  });

  it('should_withhold_every_secret_suffix_from_the_portal', () => {
    for (const key of [
      'KOBOX_X_APIKEY',
      'KOBOX_X_API_KEY',
      'KOBOX_X_SECRET',
      'KOBOX_X_TOKEN',
      'KOBOX_X_PASSWORD',
      'KOBOX_X_WEBHOOK',
      'KOBOX_X_PIN',
      'KOBOX_IBLOCKLIST_USER',
      'KOBOX_DISCORD_WEBHOOK',
    ]) {
      expect(isWorkerOnlyEnv(key), key).toBe(true);
    }
  });

  it('should_hand_the_portal_a_key_that_only_contains_a_secret_word', () => {
    // the convention matches a suffix: a key merely mentioning the word is config
    for (const key of ['KOBOX_TOKEN_TTL', 'KOBOX_PINNED', 'KOBOX_XSECRET', 'KOBOX_SECRET_FILE_DIR']) {
      expect(isWorkerOnlyEnv(key), key).toBe(false);
    }
  });
});

describe('installation rendering: sshd port', () => {
  it.each([21, 23, 2222])('should_declare_port_%i_since_it_is_not_the_default', (port) => {
    expect(renderSshdDropin(port).content.split('\n')[1]).toBe(`Port ${String(port)}`);
  });

  it('should_go_straight_to_the_hardening_on_the_default_port', () => {
    expect(renderSshdDropin(22).content.split('\n')[1]).toBe('AddressFamily inet');
  });
});

