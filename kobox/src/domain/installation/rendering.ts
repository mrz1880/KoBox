import { DEBIAN_RELEASE, PHP_FPM, RUTORRENT_DIR, WEB_SERVER_USER } from './platform.js';
import { PORTAL_USER_VARIABLE } from './NextcloudPort.js';
import { DomainError } from '../shared/DomainError.js';
import type { RenderedFile } from '../shared/files.js';
import { HOME_BASE, homeOf } from '../user/homeDirectory.js';
import type { AccountIds } from '../security/ports.js';
import type { Username } from '../user/Username.js';

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
      // the DB is shared with the non-root portal (same kobox-portal group):
      // 0007 keeps SQLite's WAL/-shm files group-writable
      'UMask=0007',
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

export interface PortalUnitSettings {
  readonly nodeBin: string;
  readonly portalMain: string;
}

// The SSR portal (Phase 6): runs NON-ROOT under the kobox-portal identity — it
// only reads repositories and enqueues typed jobs, never touching a privileged
// adapter. SyslogIdentifier keys the fail2ban portal jail.
export function renderPortalUnit(settings: PortalUnitSettings): RenderedFile {
  return {
    path: '/etc/systemd/system/kobox-portal.service',
    content: [
      MANAGED_HEADER,
      '[Unit]',
      'Description=KoBox SSR portal (non-privileged web interface)',
      'After=network.target kobox-worker.service',
      'StartLimitIntervalSec=0',
      '',
      '[Service]',
      'Type=simple',
      'User=kobox-portal',
      'Group=kobox-portal',
      `ExecStart=${settings.nodeBin} ${settings.portalMain}`,
      // its OWN env file, not the worker's: same config minus every secret the
      // portal never uses (debrid key, aria2 RPC secret, webhooks…)
      'EnvironmentFile=-/etc/kobox/portal.env',
      // shares the DB with the root worker (kobox-portal group); 0007 keeps
      // new SQLite WAL/-shm files group-writable
      'UMask=0007',
      // defense-in-depth for a process whose whole design is zero-privilege:
      // everything read-only except the shared database directory it must write
      // (sessions, WAL/-shm). PrivateTmp stays off — the portal keeps nothing in
      // /tmp, and a private one would only hide the shared DB during tests.
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      'ReadWritePaths=/var/lib/kobox',
      'SyslogIdentifier=kobox-portal',
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

// Phase 8 — NanoMon monitoring. Runs NON-ROOT under a dedicated `nanomon`
// account and read-only: it only reads /proc + /sys and queries systemd, keeps
// its history in memory, and binds loopback (nginx gates /monitoring on the
// admin session). Config is inline Environment= (no secrets).
export function renderNanomonUnit(): RenderedFile {
  return {
    path: '/etc/systemd/system/kobox-nanomon.service',
    content: [
      MANAGED_HEADER,
      '[Unit]',
      'Description=KoBox host monitoring (NanoMon)',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      'User=nanomon',
      'Group=nanomon',
      'ExecStart=/usr/local/bin/nanomon',
      'Environment=NANOMON_BIND=127.0.0.1',
      `Environment=NANOMON_PORT=${String(NANOMON_PORT)}`,
      'Environment=NANOMON_ENABLE_SYSTEMD=true',
      'Environment=NANOMON_SERVICE_FILTER=rtorrent-*,kobox-*,nginx',
      // a read-only monitor: no writable paths, no new privileges
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      'PrivateTmp=yes',
      'SyslogIdentifier=kobox-nanomon',
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

// Phase 9 — aria2 RPC port (localhost only). The worker's Aria2Adapter talks
// to it here; it is never exposed off-box.
export const ARIA2_RPC_PORT = 6800;

// The aria2 config carries the RPC secret, so it is 0640 root:kobox-aria2 (not
// world-readable) and the secret is read from the file — never passed on the
// command line where /proc/<pid>/cmdline would leak it.
export function renderAria2Conf(secret: string, stagingDir: string): RenderedFile {
  return {
    path: '/etc/kobox/aria2.conf',
    content: [
      MANAGED_HEADER,
      'enable-rpc=true',
      'rpc-listen-all=false',
      `rpc-listen-port=${String(ARIA2_RPC_PORT)}`,
      `rpc-secret=${secret}`,
      `dir=${stagingDir}`,
      'continue=true',
      'max-connection-per-server=8',
      'allow-overwrite=true',
      '',
    ].join('\n'),
    mode: '0640',
    owner: 'root',
    group: 'kobox-aria2',
  };
}

// aria2 runs NON-ROOT (kobox-aria2), read-only except the staging dir it writes
// downloads into; the root worker moves finished files into the user home.
export function renderAria2Unit(stagingDir: string): RenderedFile {
  return {
    path: '/etc/systemd/system/kobox-aria2.service',
    content: [
      MANAGED_HEADER,
      '[Unit]',
      'Description=KoBox aria2 download engine (debrid downloads)',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      'User=kobox-aria2',
      'Group=kobox-aria2',
      'ExecStart=/usr/bin/aria2c --conf-path=/etc/kobox/aria2.conf',
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      `ReadWritePaths=${stagingDir}`,
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

// Env entries only the ROOT worker may hold: credentials and capability URLs it
// alone acts on (debrid key, aria2 RPC secret, blocklist subscription
// credentials, notification webhooks). The non-root portal never calls those
// paths — it reads repositories and enqueues jobs — so it must not receive them.
const WORKER_ONLY_ENV_NAMES: readonly string[] = [
  'KOBOX_ALLDEBRID_APIKEY',
  'KOBOX_ARIA2_RPC_SECRET',
  'KOBOX_IBLOCKLIST_USER',
  'KOBOX_IBLOCKLIST_PIN',
  'KOBOX_NTFY_URL',
  'KOBOX_DISCORD_WEBHOOK',
];

// Also matched by naming convention, so a secret added later is withheld from
// the portal BY DEFAULT instead of leaking until someone updates the list above.
const WORKER_ONLY_ENV_SUFFIX = /_(?:APIKEY|API_KEY|SECRET|TOKEN|PASSWORD|WEBHOOK|PIN)$/;

export function isWorkerOnlyEnv(key: string): boolean {
  return WORKER_ONLY_ENV_NAMES.includes(key) || WORKER_ONLY_ENV_SUFFIX.test(key);
}

function envLines(vars: ReadonlyMap<string, string>, keep: (key: string) => boolean): string[] {
  const lines: string[] = [];
  for (const [key, value] of [...vars.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new InvalidWorkerEnvError(`key ${JSON.stringify(key)}`);
    }
    if (value.includes('\n')) {
      throw new InvalidWorkerEnvError(`value of ${key} contains a newline`);
    }
    if (keep(key)) {
      lines.push(`${key}=${value}`);
    }
  }
  return lines;
}

// Snapshot of the relevant KOBOX_* env at install time, so the systemd worker
// runs with the same configuration the installer saw. Sorted for determinism.
// Root-only (0600): this is the file that holds every secret.
export function renderWorkerEnv(vars: ReadonlyMap<string, string>): RenderedFile {
  return {
    path: '/etc/kobox/worker.env',
    content: [MANAGED_HEADER, ...envLines(vars, () => true), ''].join('\n'),
    mode: '0600',
    owner: 'root',
    group: 'root',
  };
}

// The same snapshot MINUS every worker-only secret, for the non-root portal
// (least privilege: /proc/<portal-pid>/environ is readable by its own uid, so a
// secret it never uses must not be there at all). 0640 root:kobox-portal.
export function renderPortalEnv(vars: ReadonlyMap<string, string>): RenderedFile {
  return {
    path: '/etc/kobox/portal.env',
    content: [MANAGED_HEADER, ...envLines(vars, (key) => !isWorkerOnlyEnv(key)), ''].join('\n'),
    mode: '0640',
    owner: 'root',
    group: 'kobox-portal',
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

// Canonical apt sources for the target release, in the deb822 format trixie
// ships. Rendered ONLY behind --manage-apt-sources: clobbering an
// operator-edited source silently is legacy §5.2. The legacy sources.list is
// emptied of its entries, because a box upgraded in place still lists the
// previous release there and apt would read every suite twice.
export function renderAptSources(): readonly RenderedFile[] {
  const { codename } = DEBIAN_RELEASE;
  const stanza = (uri: string, suites: string): string =>
    [
      'Types: deb',
      `URIs: ${uri}`,
      `Suites: ${suites}`,
      // non-free: unrar, the only one that opens RAR5 archives (ruTorrent's unpack)
      'Components: main contrib non-free non-free-firmware',
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp',
    ].join('\n');
  return [
    {
      path: '/etc/apt/sources.list.d/debian.sources',
      content: [
        MANAGED_HEADER,
        stanza('http://deb.debian.org/debian', `${codename} ${codename}-updates`),
        '',
        stanza('http://deb.debian.org/debian-security', `${codename}-security`),
        '',
      ].join('\n'),
      mode: '0644',
      owner: 'root',
      group: 'root',
    },
    {
      path: '/etc/apt/sources.list',
      content: [MANAGED_HEADER, '# Sources live in /etc/apt/sources.list.d/debian.sources.', ''].join(
        '\n',
      ),
      mode: '0644',
      owner: 'root',
      group: 'root',
    },
  ];
}

export interface NginxVhostSettings {
  readonly portalPort: number;
  // present once certbot issued a certificate: the vhost then serves the
  // real chain instead of the snakeoil placeholder
  readonly letsencrypt?: { readonly domain: string };
}

export const ACME_WEBROOT = '/var/www/acme';

// The KoBox portal HTTP port (Phase 6): nginx reverse-proxies the SSR portal
// and delegates /ru + /RPC-* protection to it via auth_request.
export const PORTAL_HTTP_PORT = 8190;

// Phase 8 — NanoMon binds loopback here; nginx proxies /monitoring to it.
export const NANOMON_PORT = 8191;

// Phase 6: the shared Basic Auth is retired. The SSR portal owns auth; nginx
// proxies it on / and gates ruTorrent (/ru) and the per-user SCGI mounts
// (/RPC-<USER>, pulled from the rendered include dir) with auth_request
// subrequests to the portal. Snakeoil TLS until the letsencrypt component
// confirms an issued certificate. The :80 block only serves ACME challenges
// (webroot) and shoves everything else to the TLS portal.
// The standard HTTPS port: the portal answers there as well as on its own port.
export const HTTPS_PORT = 443;

export function renderNginxVhost(settings: NginxVhostSettings): RenderedFile {
  const le = settings.letsencrypt;
  const portal = `http://127.0.0.1:${String(PORTAL_HTTP_PORT)}`;
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
      // the standard port serves the portal too, so plain http goes there
      '        return 301 https://$host$request_uri;',
      '    }',
      '}',
      '',
      'server {',
      `    listen ${String(settings.portalPort)} ssl;`,
      // what people type; the portal port stays for download clients
      `    listen ${String(HTTPS_PORT)} ssl;`,
      '    http2 on;',
      `    server_name ${le ? le.domain : '_'};`,
      ...certLines,
      '',
      '    # auth_request targets: the portal answers 204 (allow) or 401/403',
      '    location = /internal/auth {',
      '        internal;',
      `        proxy_pass ${portal}/internal/auth;`,
      '        proxy_pass_request_body off;',
      '        proxy_set_header Content-Length "";',
      '        proxy_set_header X-Original-URI $request_uri;',
      '    }',
      '    location = /internal/auth/rpc {',
      '        internal;',
      `        proxy_pass ${portal}/internal/auth/rpc;`,
      '        proxy_pass_request_body off;',
      '        proxy_set_header Content-Length "";',
      '        proxy_set_header X-Original-URI $request_uri;',
      '    }',
      '    location = /internal/auth/admin {',
      '        internal;',
      `        proxy_pass ${portal}/internal/auth/admin;`,
      '        proxy_pass_request_body off;',
      '        proxy_set_header Content-Length "";',
      '        proxy_set_header X-Original-URI $request_uri;',
      '    }',
      // never refuses: it only names who is signed in, for Nextcloud
      '    location = /internal/auth/session {',
      '        internal;',
      `        proxy_pass ${portal}/internal/auth/session;`,
      '        proxy_pass_request_body off;',
      '        proxy_set_header Content-Length "";',
      '    }',
      '',
      '    # the SSR portal (application auth, sessions, CSRF)',
      '    location / {',
      `        proxy_pass ${portal};`,
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Forwarded-For $remote_addr;',
      '        proxy_set_header X-Forwarded-Proto https;',
      '    }',
      '',
      '    # ruTorrent, gated by the portal session; the authenticated user is',
      '    # forwarded to php-fpm as REMOTE_USER for the per-user profile',
      '    location /ru/ {',
      '        auth_request /internal/auth;',
      '        auth_request_set $kobox_user $upstream_http_x_kobox_user;',
      `        alias ${RUTORRENT_DIR}/;`,
      // ruTorrent 5.x ships index.html; 4.x shipped index.php. Naming only one
      // of them makes nginx fall through to a directory listing, which it
      // refuses — a 403 on the very first visit.
      '        index index.html index.php;',
      '    }',
      '',
      // share/ holds every member's profile (uploaded .torrent files carry
      // private-tracker passkeys), conf/ the per-user wiring, tests/ dev code.
      // Listed before the .php regex: nginx keeps the first regex that matches.
      '    location ~ ^/ru/(share|conf|tests)/ {',
      '        deny all;',
      '    }',
      '',
      // ruTorrent's disk meter asks this one address for the space it shows:
      // KoBox answers it with the member's quota, behind the same session
      // check, and ruTorrent's own files stay as they ship
      '    location = /ru/plugins/diskspace/action.php {',
      '        auth_request /internal/auth;',
      '        auth_request_set $kobox_user $upstream_http_x_kobox_user;',
      '        include fastcgi_params;',
      `        fastcgi_param SCRIPT_FILENAME ${RUTORRENT_QUOTA_ANSWER};`,
      '        fastcgi_param REMOTE_USER $kobox_user;',
      `        fastcgi_pass unix:${PHP_FPM.socket};`,
      '    }',
      '',
      '    location ~ ^/ru/(.+\\.php)$ {',
      '        auth_request /internal/auth;',
      '        auth_request_set $kobox_user $upstream_http_x_kobox_user;',
      '        include fastcgi_params;',
      `        fastcgi_param SCRIPT_FILENAME ${RUTORRENT_DIR}/$1;`,
      '        fastcgi_param REMOTE_USER $kobox_user;',
      `        fastcgi_pass unix:${PHP_FPM.socket};`,
      '    }',
      '',
      '    # per-user SCGI mounts (/RPC-<USER>), each gated to its owner or an admin',
      '    include /etc/nginx/kobox.d/*.conf;',
      '',
      '    # ShellInABox (localhost:4200), admin-only through the portal session',
      '    location /shell/ {',
      '        auth_request /internal/auth/admin;',
      '        proxy_pass http://127.0.0.1:4200/;',
      '        proxy_set_header Host $host;',
      '    }',
      '',
      '    # NanoMon host monitoring (localhost), admin-only through the portal',
      // The bytes of a user's completed downloads. `internal` means a browser
      // can never request this directly: it is reachable only through an
      // X-Accel-Redirect the portal emits after checking the session and that
      // the file belongs to that user. nginx handles range requests, so seeking
      // in a video works without the portal ever touching disk.
      // The path the portal sends is relative to the member's complete/ dir,
      // which is what the media index stores. Aliasing straight to /home/ sent
      // nginx to /home/<member>/films/... and every download 404ed: the portal
      // answers 200 with a header, so no test that stops at the portal could
      // ever see it.
      '    location ~ ^/internal-media/([^/]+)/(.+)$ {',
      '        internal;',
      `        alias ${HOME_BASE}/$1/rtorrent/complete/$2;`,
      '    }',
      '',
      '    location /monitoring/ {',
      '        auth_request /internal/auth/admin;',
      `        proxy_pass http://127.0.0.1:${String(NANOMON_PORT)}/;`,
      '        proxy_set_header Host $host;',
      '    }',
      '}',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// NFS v3 asks rpcbind where mountd listens, and by default that is a random
// port. Pinned, the firewall can open it to the VPN tunnels and nothing else.
export const NFS_MOUNTD_PORT = 32767;

export function renderNfsConf(): RenderedFile {
  return {
    path: '/etc/nfs.conf.d/kobox.conf',
    content: [MANAGED_HEADER, '[mountd]', `port=${String(NFS_MOUNTD_PORT)}`, ''].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

export interface NfsExportWiring {
  readonly username: Username;
  readonly ids: AccountIds;
  // the member's own VPN addresses and the trusted addresses added by hand
  readonly clients: readonly string[];
}

// Per-member home exports, each scoped to one client address: NFS v3 trusts the
// address alone, so a member with no client exports to nobody, never to a
// subnet or a wildcard. all_squash maps every request to the member, so what a
// NAS writes is theirs whatever uids that machine uses.
export function renderNfsExports(users: readonly NfsExportWiring[]): RenderedFile {
  const lines: string[] = [];
  for (const user of users) {
    const options = `rw,sync,no_subtree_check,all_squash,anonuid=${String(user.ids.uid)},anongid=${String(user.ids.gid)}`;
    for (const client of user.clients) {
      lines.push(`${homeOf(user.username)} ${client}(${options})`);
    }
  }
  return {
    path: '/etc/exports.d/kobox.exports',
    content: [MANAGED_HEADER, ...lines, ''].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// The one port Samba answers on (no NetBIOS): the firewall opens it to the VPN
// tunnels only, since a share exposed to the internet is a classic target.
export const SAMBA_PORT = 445;

// Samba: user-level security with per-user [homes] shares (KEEP from prod).
// Passwords live in the Samba tdb: a member's is their portal password, set
// through smbpasswd stdin whenever it is set on the portal.
export function renderSmbConf(): RenderedFile {
  return {
    path: '/etc/samba/smb.conf',
    content: [
      MANAGED_HEADER,
      '[global]',
      '    workgroup = WORKGROUP',
      '    server string = KoBox',
      '    security = user',
      '    map to guest = never',
      '    server role = standalone server',
      '    disable netbios = yes',
      `    smb ports = ${String(SAMBA_PORT)}`,
      '',
      '[homes]',
      '    comment = Home directory',
      '    browseable = no',
      '    read only = no',
      '    create mask = 0600',
      '    directory mask = 0700',
      '    valid users = %S',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// ShellInABox hardened to localhost (Phase 5 debt): it only ever listens on
// 127.0.0.1:4200 behind the portal's admin-gated /shell proxy, never exposed.
export function renderShellinaboxDefault(): RenderedFile {
  return {
    path: '/etc/default/shellinabox',
    content: [
      MANAGED_HEADER,
      'SHELLINABOX_DAEMON_START=1',
      'SHELLINABOX_PORT=4200',
      'SHELLINABOX_ARGS="--no-beep --localhost-only --disable-ssl --service=/:LOGIN --bind=127.0.0.1"',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

export interface RutorrentUserWiring {
  readonly username: string;
  readonly scgiPort: number;
}

// The per-user SCGI mounts: one `/RPC-<UPPERCASE>` location per active user
// (legacy /RPC-<USER> parity), each gated by the portal to its owner (or an
// admin). Rendered as a single include so nginx reloads see the whole set
// atomically.
export function renderRutorrentUsersInclude(users: readonly RutorrentUserWiring[]): RenderedFile {
  const blocks = users.map((user) =>
    [
      `location = /RPC-${user.username.toUpperCase()} {`,
      '    auth_request /internal/auth/rpc;',
      '    include scgi_params;',
      `    scgi_pass 127.0.0.1:${String(user.scgiPort)};`,
      '}',
    ].join('\n'),
  );
  return {
    path: '/etc/nginx/kobox.d/rutorrent-users.conf',
    content: [MANAGED_HEADER, ...blocks, ''].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// The per-user ruTorrent config the multiuser layout reads for REMOTE_USER:
// binds that user's SCGI mount so ruTorrent talks to their own rtorrent.
export function renderRutorrentUserConfig(user: RutorrentUserWiring): RenderedFile {
  return {
    path: `${RUTORRENT_DIR}/conf/users/${user.username}/config.php`,
    content: [
      '<?php',
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      `$scgi_port = ${String(user.scgiPort)};`,
      "$scgi_host = '127.0.0.1';",
      `$XMLRPCMountPoint = '/RPC-${user.username.toUpperCase()}';`,
      // ruTorrent runs as the web server, in every member's group: bounded by
      // /home alone, its folder picker would list another member's downloads
      `$topDirectory = '${HOME_BASE}/${user.username}/';`,
      '',
    ].join('\n'),
    mode: '0640',
    owner: 'root',
    group: 'www-data',
  };
}

// Nextcloud is a PHP application like ruTorrent, served from its own prefix
// behind the same portal session. Its own front controller does the routing, so
// this is a plain fastcgi block rather than the per-user SCGI wiring above.
// Nextcloud's reference layout for a sub-directory install. Nextcloud
// authenticates its own clients: the desktop and mobile apps send Nextcloud
// credentials that the portal session check would refuse, so the only check
// here is the one that never refuses. It names the member signed in to the
// portal, and Nextcloud's SSO app opens their session from that name: it
// believes it without checking, so PORTAL_USER_VARIABLE is set here and nowhere
// else, and a client cannot reach it (requests only produce HTTP_* names).
// PHP gets the path after the script (remote.php/dav/..., index.php/login),
// which the apps and the web interface both depend on.
export function renderNextcloudSite(): RenderedFile {
  return {
    path: '/etc/nginx/kobox.d/nextcloud.conf',
    content: [
      MANAGED_HEADER,
      'location ^~ /nextcloud {',
      // root, not alias: the tree is /var/www/nextcloud and nested regex
      // locations resolve against root reliably
      '    root /var/www;',
      '    client_max_body_size 512M;',
      '    client_body_timeout 300s;',
      '    fastcgi_buffers 64 4K;',
      '    index index.php index.html /nextcloud/index.php$request_uri;',
      '',
      '    # internal trees, and the data directory whatever it resolves to',
      '    location ~ ^/nextcloud/(?:build|tests|config|lib|3rdparty|templates|data)(?:$|/) {',
      '        return 404;',
      '    }',
      '    location ~ ^/nextcloud/(?:\\.|autotest|occ|issue|indie|db_|console) {',
      '        return 404;',
      '    }',
      '',
      '    location ~ \\.php(?:$|/) {',
      '        rewrite ^/nextcloud/(?!index|remote|public|cron|core\\/ajax\\/update|status|ocs\\/v[12]|updater\\/.+|ocs-provider\\/.+) /nextcloud/index.php$request_uri;',
      '        fastcgi_split_path_info ^(.+?\\.php)(/.*)$;',
      '        set $path_info $fastcgi_path_info;',
      '        try_files $fastcgi_script_name =404;',
      '        auth_request /internal/auth/session;',
      '        auth_request_set $kobox_portal_user $upstream_http_x_kobox_user;',
      '        include fastcgi_params;',
      '        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;',
      '        fastcgi_param PATH_INFO $path_info;',
      `        fastcgi_param ${PORTAL_USER_VARIABLE} $kobox_portal_user;`,
      '        fastcgi_param HTTPS on;',
      '        fastcgi_param modHeadersAvailable true;',
      '        fastcgi_intercept_errors on;',
      '        fastcgi_request_buffering off;',
      `        fastcgi_pass unix:${PHP_FPM.socket};`,
      '    }',
      '',
      '    location ~ \\.(?:css|js|mjs|svg|gif|png|jpg|ico|wasm|tflite|map|ogg|flac|woff2?)$ {',
      '        try_files $uri /nextcloud/index.php$request_uri;',
      '    }',
      '    location /nextcloud/remote {',
      '        return 301 /nextcloud/remote.php$request_uri;',
      '    }',
      '    location /nextcloud {',
      '        try_files $uri $uri/ /nextcloud/index.php$request_uri;',
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

// Where ruTorrent keeps every member's profile (settings, uploaded .torrent
// files). Out of the /var/www tree on purpose: no web server can serve it.
export const RUTORRENT_PROFILE_DIR = '/var/lib/rutorrent';

// ruTorrent's own layout under it: one folder per member, in users/.
export function rutorrentProfilesDir(): string {
  return `${RUTORRENT_PROFILE_DIR}/users`;
}

// What ruTorrent's disk meter shows a member: their quota, in the meter's own
// format (total and free bytes), not the whole disk's free space. Written by
// the root worker after each disk usage sample, read by the web server for
// that member only.
export function renderQuotaGauge(username: string, usedBytes: number, quotaBytes: number): RenderedFile {
  return {
    path: `${rutorrentProfilesDir()}/${username}/kobox-quota.json`,
    content: `${JSON.stringify({ total: quotaBytes, free: Math.max(0, quotaBytes - usedBytes) })}\n`,
    mode: '0640',
    owner: WEB_SERVER_USER,
    group: username,
  };
}

const RUTORRENT_QUOTA_ANSWER = '/usr/local/share/kobox/rutorrent-quota.php';

// Served in place of plugins/diskspace/action.php: the member's own gauge, or
// nothing known yet (total 0, which the meter leaves empty).
export function renderRutorrentQuotaAnswer(): RenderedFile {
  return {
    path: RUTORRENT_QUOTA_ANSWER,
    content: [
      '<?php',
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      `chdir('${RUTORRENT_DIR}/plugins/diskspace');`,
      `require_once '${RUTORRENT_DIR}/php/util.php';`,
      "$gauge = FileUtil::getProfilePath() . '/kobox-quota.json';",
      `$answer = is_readable($gauge) ? file_get_contents($gauge) : '{"total":0,"free":0}';`,
      "CachedEcho::send($answer, 'application/json');",
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// ruTorrent's own conf/config.php holds every default its plugins read
// ($throttleMaxSpeed, $do_diagnostic, $pathToExternals...) and loads
// config.local.php last: KoBox writes only what it changes, there. Per-member
// SCGI wiring lives in conf/users/<member>/config.php.
export const RUTORRENT_OWN_CONFIG = `${RUTORRENT_DIR}/conf/config.php`;

export function renderRutorrentConfig(): RenderedFile {
  return {
    path: `${RUTORRENT_DIR}/conf/config.local.php`,
    content: [
      '<?php',
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      `$topDirectory = '${HOME_BASE}';`,
      `$profilePath = '${RUTORRENT_PROFILE_DIR}';`,
      // a member's profile folders: them and the web server, nobody else
      '$profileMask = 0770;',
      '',
    ].join('\n'),
    mode: '0640',
    owner: 'root',
    group: 'www-data',
  };
}

// The ratio groups members are offered in ruTorrent, in place of its own eight
// alike ones (ratio0 to ratio7). A group stops a torrent once its ratio reaches
// the percentage, or once it has seeded that many hours; never erases anything.
// A ratio that cannot be reached (1000x) leaves a group to its duration alone.
interface RatioGroup {
  readonly name: string;
  readonly ratioPercent: number;
  readonly seedHours?: number;
}

const UNREACHABLE_RATIO_PERCENT = 100_000;

const RATIO_GROUPS: readonly RatioGroup[] = [
  { name: 'Privé : ratio 1 ou 3 jours', ratioPercent: 100, seedHours: 72 },
  { name: 'Privé exigeant : ratio 2 ou 7 jours', ratioPercent: 200, seedHours: 168 },
  { name: 'Public : ratio 1', ratioPercent: 100 },
  { name: 'Court : 24 h', ratioPercent: UNREACHABLE_RATIO_PERCENT, seedHours: 24 },
];

// Run as the web server for one member (REMOTE_USER), through ruTorrent's own
// ratio code, so the groups land where and how ruTorrent keeps them. It writes
// only over ruTorrent's untouched defaults: a member who changed any group
// keeps theirs, now and on every later run.
export function renderRutorrentRatioOffer(): RenderedFile {
  const groups = RATIO_GROUPS.map(
    (group) =>
      `  ['action' => RAT_STOP, 'name' => '${group.name}', 'min' => ${String(group.ratioPercent)}, 'max' => ${String(group.ratioPercent)}, 'upload' => 0, 'time' => ${String(group.seedHours ?? -1)}],`,
  );
  return {
    path: '/usr/local/share/kobox/rutorrent-ratios.php',
    content: [
      '<?php',
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      // a ruTorrent release without its ratio plugin: nothing to offer
      `if (!is_file('${RUTORRENT_DIR}/plugins/ratio/ratio.php')) {`,
      '  exit(0);',
      '}',
      `chdir('${RUTORRENT_DIR}/plugins/ratio');`,
      "require_once 'ratio.php';",
      '$ratio = rRatio::load();',
      'foreach ($ratio->rat as $i => $group) {',
      "  $untouched = $group['name'] === 'ratio' . $i && $group['min'] == 100 && $group['max'] == 300",
      "    && $group['upload'] == 0.1 && $group['time'] == -1 && $group['action'] == RAT_STOP;",
      '  if (!$untouched) {',
      '    exit(0);',
      '  }',
      '}',
      '$ratio->rat = [',
      ...groups,
      '];',
      '$ratio->pad();',
      '(new rCache())->set($ratio);',
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// The theme a member gets until they pick one in ruTorrent's settings: its dark
// blue sits with the portal around it. The theme plugin loads this file after
// its own conf.php, so ruTorrent's release stays as it ships.
const DEFAULT_RUTORRENT_THEME = 'MaterialDesign';

export function renderRutorrentDefaultTheme(): RenderedFile {
  return {
    path: `${RUTORRENT_DIR}/plugins/theme/conf.local.php`,
    content: [
      '<?php',
      '// KoBox-managed — DO NOT EDIT (rendered declaratively).',
      `$defaultTheme = "${DEFAULT_RUTORRENT_THEME}";`,
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// Plugins switched off for every member:
// - dump needs dumptorrent, which no Debian release packages: an error at every
//   load otherwise;
// - retrackers can add public trackers to a private torrent, which trackers ban;
// - extsearch searches public sites.
const DISABLED_RUTORRENT_PLUGINS = ['dump', 'retrackers', 'extsearch'];

// ruTorrent reads one plugins.ini (a member's own replaces the global one
// whole), so this one carries ruTorrent's default rights as it ships them, then
// the plugins switched off.
export function renderRutorrentPlugins(): RenderedFile {
  return {
    path: `${RUTORRENT_DIR}/conf/plugins.ini`,
    content: [
      ';; KoBox-managed — DO NOT EDIT (rendered declaratively).',
      '[default]',
      'enabled = user-defined',
      'canChangeToolbar = yes',
      'canChangeMenu = yes',
      'canChangeOptions = yes',
      'canChangeTabs = yes',
      'canChangeColumns = yes',
      'canChangeStatusBar = yes',
      'canChangeCategory = yes',
      'canBeShutdowned = yes',
      ...DISABLED_RUTORRENT_PLUGINS.flatMap((plugin) => ['', `[${plugin}]`, 'enabled = no']),
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
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
  // false where Debian does not package dnscrypt-proxy (bookworm dropped it):
  // bind recurses directly, since forward-only to a dead port would take the
  // whole box's DNS down
  readonly dnscryptForwarder: boolean;
}

// Where bind forwards and where dnscrypt-proxy listens: one address, two configs.
const DNSCRYPT_LISTEN = { host: '127.0.0.1', port: 52 } as const;

export function renderBindOptions(settings: BindOptionsSettings): RenderedFile {
  const resolution = settings.dnscryptForwarder
    ? [
        '    forward only;',
        '    // dnscrypt-proxy validates DNSSEC upstream (require_dnssec)',
        `    forwarders { ${DNSCRYPT_LISTEN.host} port ${String(DNSCRYPT_LISTEN.port)}; };`,
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

// trixie runs dnscrypt-proxy as _dnscrypt-proxy, which may not bind below
// 1024, and its unit Requires= the socket: systemd binds as root and hands the
// listener over. The empty assignments clear Debian's 127.0.2.1:53 first.
export function renderDnscryptSocketDropIn(): RenderedFile {
  return {
    path: '/etc/systemd/system/dnscrypt-proxy.socket.d/90-kobox.conf',
    content: [
      '# KoBox-managed — DO NOT EDIT (rendered declaratively).',
      '[Socket]',
      'ListenStream=',
      'ListenDatagram=',
      `ListenStream=${DNSCRYPT_LISTEN.host}:${String(DNSCRYPT_LISTEN.port)}`,
      `ListenDatagram=${DNSCRYPT_LISTEN.host}:${String(DNSCRYPT_LISTEN.port)}`,
      '',
    ].join('\n'),
    mode: '0644',
    owner: 'root',
    group: 'root',
  };
}

// Static cloudflare stamp instead of the public-resolvers list: the service
// starts without fetching anything (deterministic in containers/CI).
export function renderDnscryptConfig(): RenderedFile {
  return {
    path: '/etc/dnscrypt-proxy/dnscrypt-proxy.toml',
    content: [
      '# KoBox-managed — DO NOT EDIT (rendered declaratively).',
      // socket activation: systemd binds the port and hands it over
      'listen_addresses = []',
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
