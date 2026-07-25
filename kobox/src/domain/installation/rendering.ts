import { DomainError } from '../shared/DomainError.js';
import type { RenderedFile } from '../shared/files.js';

const MANAGED_HEADER = '# KoBox-managed — DO NOT EDIT (rendered declaratively).';

export interface WorkerUnitSettings {
  readonly nodeBin: string;
  readonly workerMain: string;
}

export function renderWorkerUnit(settings: WorkerUnitSettings): RenderedFile {
  return {
    path: '/etc/systemd/system/kobox-worker.service',
    content: [
      MANAGED_HEADER,
      '[Unit]',
      'Description=KoBox root worker (typed job queue consumer)',
      'After=network.target',
      // the watchdog replacement promise: the worker never gives up — the
      // default start-rate limit would leave the box jobless after a burst
      // of restarts (upgrade + rollback) until a manual reset-failed
      'StartLimitIntervalSec=0',
      '',
      '[Service]',
      'Type=simple',
      `ExecStart=${settings.nodeBin} ${settings.workerMain}`,
      'EnvironmentFile=-/etc/kobox/worker.env',
      'Restart=on-failure',
      'RestartSec=2',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// Phase 3 debt #1: iptables tables are empty after a reboot; this oneshot
// restores the last applied ruleset. The Condition keeps the very first boot
// (no apply yet) clean instead of failing the unit.
export function renderFirewallBootUnit(): RenderedFile {
  return {
    path: '/etc/systemd/system/kobox-firewall.service',
    content: [
      MANAGED_HEADER,
      '[Unit]',
      'Description=KoBox firewall restore at boot',
      'ConditionPathExists=/etc/kobox/firewall.rules',
      'DefaultDependencies=no',
      'Before=network-pre.target',
      'Wants=network-pre.target',
      '',
      '[Service]',
      'Type=oneshot',
      // the ruleset may reference the kobox-bl ipset: the set must exist
      // before the restore, and the rendered entries reload best-effort
      // (`-` prefix: a kernel without ip_set must not fail the boot restore
      // — the rules file on such a host carries no match-set rule anyway)
      'ExecStartPre=-/usr/sbin/ipset create kobox-bl hash:net family inet maxelem 1048576 -exist',
      'ExecStartPre=-/usr/sbin/ipset restore -exist -file /etc/kobox/blocklist.ipset',
      'ExecStart=/usr/sbin/iptables-restore /etc/kobox/firewall.rules',
      'RemainAfterExit=yes',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

export class InvalidWorkerEnvError extends DomainError {
  constructor(detail: string) {
    super(`invalid worker environment entry: ${detail}`);
  }
}

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// Snapshot of the relevant KOBOX_* env at install time, so the systemd worker
// runs with the same configuration the installer saw. Sorted for determinism.
export function renderWorkerEnv(vars: ReadonlyMap<string, string>): RenderedFile {
  const lines: string[] = [];
  for (const [key, value] of [...vars.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new InvalidWorkerEnvError(`key ${JSON.stringify(key)}`);
    }
    if (value.includes('\n')) {
      throw new InvalidWorkerEnvError(`value of ${key} contains a newline`);
    }
    lines.push(`${key}=${value}`);
  }
  return {
    path: '/etc/kobox/worker.env',
    content: [MANAGED_HEADER, ...lines, ''].join('\n'),
    mode: '0600',
    owner: 'root',
    group: 'root',
  };
}

// Hardening that can NEVER lock anyone out: root keeps key access, users keep
// passwords (SFTP chroot parity with the legacy). A Port line is emitted only
// when the operator moved SSH — the drop-in must not fight the stock config.
export function renderSshdDropin(sshPort: number): RenderedFile {
  return {
    path: '/etc/ssh/sshd_config.d/90-kobox.conf',
    content: [
      MANAGED_HEADER,
      ...(sshPort === 22 ? [] : [`Port ${String(sshPort)}`]),
      'PermitRootLogin prohibit-password',
      'PasswordAuthentication yes',
      'X11Forwarding no',
      'MaxAuthTries 4',
      'LoginGraceTime 30',
      'ClientAliveInterval 300',
      'ClientAliveCountMax 2',
      '',
    ].join('\n'),
    mode: '0600',
    owner: 'root',
    group: 'root',
  };
}

// The seedbox-relevant subset of the legacy install/Tweaks — conservative
// keys that apply in a privileged container too. No GRUB, no governor, no
// fstab (brick territory).
export function renderSysctlTweaks(): RenderedFile {
  return {
    path: '/etc/sysctl.d/90-kobox.conf',
    content: [
      MANAGED_HEADER,
      'net.core.somaxconn = 1024',
      'net.core.rmem_max = 16777216',
      'net.core.wmem_max = 16777216',
      'net.ipv4.tcp_fin_timeout = 15',
      'net.ipv4.tcp_tw_reuse = 1',
      'fs.inotify.max_user_watches = 524288',
      'fs.inotify.max_user_instances = 1024',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// Canonical Debian 12 sources. Rendered ONLY behind --manage-apt-sources:
// clobbering an operator-edited sources.list silently is legacy §5.2.
export function renderAptSources(): RenderedFile {
  return {
    path: '/etc/apt/sources.list',
    content: [
      MANAGED_HEADER,
      'deb http://deb.debian.org/debian bookworm main contrib non-free-firmware',
      'deb http://deb.debian.org/debian bookworm-updates main contrib non-free-firmware',
      'deb http://security.debian.org/debian-security bookworm-security main contrib non-free-firmware',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

export interface NginxVhostSettings {
  readonly portalPort: number;
  // present once certbot issued a certificate: the vhost then serves the
  // real chain instead of the snakeoil placeholder
  readonly letsencrypt?: { readonly domain: string };
}

export const ACME_WEBROOT = '/var/www/acme';

// Secure by default: auth_basic against an initially EMPTY htpasswd denies
// everyone until the portal phase wires real accounts. Snakeoil TLS until
// the letsencrypt component confirms an issued certificate. The :80 block
// only serves ACME challenges (webroot) and shoves everything else to the
// TLS portal.
export function renderNginxVhost(settings: NginxVhostSettings): RenderedFile {
  const le = settings.letsencrypt;
  const certLines = le
    ? [
        `    ssl_certificate /etc/letsencrypt/live/${le.domain}/fullchain.pem;`,
        `    ssl_certificate_key /etc/letsencrypt/live/${le.domain}/privkey.pem;`,
      ]
    : [
        '    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;',
        '    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;',
      ];
  return {
    path: '/etc/nginx/conf.d/kobox.conf',
    content: [
      MANAGED_HEADER,
      'server {',
      '    listen 80;',
      '    server_name _;',
      '',
      '    location /.well-known/acme-challenge/ {',
      `        root ${ACME_WEBROOT};`,
      '    }',
      '',
      '    location / {',
      `        return 301 https://$host:${String(settings.portalPort)}$request_uri;`,
      '    }',
      '}',
      '',
      'server {',
      // nginx 1.22 (Debian 12) syntax — `http2 on;` only exists from 1.25
      `    listen ${String(settings.portalPort)} ssl http2;`,
      `    server_name ${le ? le.domain : '_'};`,
      ...certLines,
      '',
      '    auth_basic "KoBox";',
      '    auth_basic_user_file /etc/nginx/kobox.htpasswd;',
      '',
      '    root /var/www/kobox;',
      '',
      '    location /ru/ {',
      '        alias /var/www/rutorrent/;',
      '        index index.html index.php;',
      '    }',
      '',
      '    location ~ ^/ru/(.+\\.php)$ {',
      '        include fastcgi_params;',
      '        fastcgi_param SCRIPT_FILENAME /var/www/rutorrent/$1;',
      '        fastcgi_pass unix:/run/php/php8.2-fpm.sock;',
      '    }',
      '}',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// Renewals ride the packaged certbot.timer; this hook makes nginx pick the
// fresh chain up. deploy/ = runs only after an actual renewal, never on dry
// runs or no-ops.
export function renderCertbotDeployHook(): RenderedFile {
  return {
    path: '/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx',
    content: ['#!/bin/sh', '# KoBox-managed — DO NOT EDIT (rendered declaratively).', 'systemctl reload nginx', ''].join('\n'),
    mode: '0755',
    owner: 'root',
    group: 'root',
  };
}

// Global ruTorrent settings only — per-user profiles and their SCGI wiring
// belong to the portal/auth slice (Phase 6).
export function renderRutorrentConfig(): RenderedFile {
  return {
    path: '/var/www/rutorrent/conf/config.php',
    content: [
      '<?php',
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      "$topDirectory = '/home';",
      "$scgi_port = 5000;",
      "$scgi_host = '127.0.0.1';",
      "$XMLRPCMountPoint = '/RPC2';",
      '$saveUploadedTorrents = true;',
      '$overwriteUploadedTorrents = false;',
      '',
    ].join('\n'),
    mode: '0640',
    owner: 'root',
    group: 'www-data',
  };
}

// Fresh-box ownership of the two stock bind files (diff-only writes via
// ManagedFilesPort). The include wires the Phase 2 blacklist zones in.
export function renderBindLocal(): RenderedFile {
  return {
    path: '/etc/bind/named.conf.local',
    content: [
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      'include "/etc/bind/kobox.zones.blacklists";',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'bind',
  };
}

export interface BindOptionsSettings {
  // false where Debian does not package dnscrypt-proxy (bookworm dropped
  // it): bind recurses directly — forward-only to a dead port would take the
  // whole box's DNS down
  readonly dnscryptForwarder: boolean;
}

export function renderBindOptions(settings: BindOptionsSettings): RenderedFile {
  const resolution = settings.dnscryptForwarder
    ? [
        '    forward only;',
        '    // dnscrypt-proxy validates DNSSEC upstream (require_dnssec)',
        '    forwarders { 127.0.0.1 port 52; };',
        '    dnssec-validation no;',
      ]
    : ['    dnssec-validation auto;'];
  return {
    path: '/etc/bind/named.conf.options',
    content: [
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      'options {',
      '    directory "/var/cache/bind";',
      '    listen-on { 127.0.0.1; };',
      '    listen-on-v6 { ::1; };',
      '    allow-query { localhost; };',
      '    recursion yes;',
      ...resolution,
      '};',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'bind',
  };
}

// Static cloudflare stamp instead of the public-resolvers list: the service
// starts without fetching anything (deterministic in containers/CI).
export function renderDnscryptConfig(): RenderedFile {
  return {
    path: '/etc/dnscrypt-proxy/dnscrypt-proxy.toml',
    content: [
      '# KoBox-managed — DO NOT EDIT (rendered declaratively).',
      "listen_addresses = ['127.0.0.1:52']",
      "server_names = ['cloudflare']",
      'require_dnssec = true',
      'require_nolog = true',
      'require_nofilter = false',
      'cache = true',
      '',
      '[blocked_names]',
      "blocked_names_file = '/etc/dnscrypt-proxy/blocked-names.txt'",
      '',
      '[static]',
      '[static.cloudflare]',
      "stamp = 'sdns://AgcAAAAAAAAABzEuMC4wLjEAEmRucy5jbG91ZGZsYXJlLmNvbQovZG5zLXF1ZXJ5'",
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}
