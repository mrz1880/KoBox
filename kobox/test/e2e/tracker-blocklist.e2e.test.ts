import { execFile, execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aTorrentFile } from '../builders/TorrentFileBuilder.js';

// Full Phase 2 E2E on a fresh Debian 12: a real torrent insert discovers the
// tracker, a REAL openssl fetches its certificate from a local TLS fixture,
// the whitelist files render idempotently, verified blocklists flow into a
// per-user ipv4 filter that a REAL rtorrent parses. No outbound network.

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const USER = 'e2etracker';
const HOME = `/home/${USER}`;
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';
const SCGI_PORT = 51101; // first allocation on a fresh DB
const TRACKER_HOST = 'tracker.example.org';
const TRACKER_TLS_PORT = 8443;
const LISTS_HOST = 'lists.example.net';
const LISTS_PORT = 8444;
const FIXTURE_IP = '127.0.0.2';
const PEM_PATH = `/etc/ssl/certs/${TRACKER_HOST}.pem`;
const ALLOW_P2P = '/etc/pgl/allow.p2p';
const ZONES = '/etc/bind/kobox.zones.blacklists';
const BLOCKED_NAMES = '/etc/dnscrypt-proxy/blocked-names.txt';

const CATALOG_XML = `<lists>
<list>
 <name>level1</name>
 <author>Example Org</author>
 <list>fixturelevel1id00000</list>
 <subscription>false</subscription>
</list>
</lists>
`;
const LIST_GZ = gzipSync(Buffer.from('Some org:192.0.2.0-192.0.2.255\nEvil corp:10.9.0.0-10.9.255.255\n'));

let env: NodeJS.ProcessEnv;
let dbPath: string;
let fixtureDir: string;
let trackerTls: TlsServer | undefined;
let listsHttps: ReturnType<typeof createHttpsServer> | undefined;
let listsServerUp = true;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

const execFileAsync = promisify(execFile);

// MUST be async: the worker child talks TLS/HTTPS to fixture servers hosted
// by THIS process — a sync exec would block the event loop and deadlock the
// handshakes (they then die on the runner's 60 s timeout).
async function drainQueue(): Promise<void> {
  await execFileAsync('node', [WORKER, '--once'], { encoding: 'utf8', env });
}

function dbRow(query: string, ...params: string[]): Record<string, unknown> | undefined {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(query).get(...params) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

function dbRun(query: string, ...params: string[]): void {
  const db = new Database(dbPath);
  try {
    db.prepare(query).run(...params);
  } finally {
    db.close();
  }
}

function unitProperty(name: string): string {
  return sh('systemctl', ['show', '-p', name, '--value', `rtorrent-${USER}`]).trim();
}

function waitForScgi(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect({ host: '127.0.0.1', port: SCGI_PORT });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error('rtorrent SCGI port never came up'));
          return;
        }
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function generateCert(cn: string, san: string): { key: Buffer; cert: Buffer } {
  const keyPath = join(fixtureDir, `${cn}.key`);
  const certPath = join(fixtureDir, `${cn}.pem`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '30',
    '-subj', `/CN=${cn}`, '-addext', `subjectAltName=${san}`,
  ], { stdio: 'ignore' });
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

describe.skipIf(!onDebianAsRoot)('E2E: tracker discovery, certs, whitelist and blocklists', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-tracker-e2e-'));
    chmodSync(dir, 0o711);
    fixtureDir = mkdtempSync(join(tmpdir(), 'kobox-tracker-fixtures-'));
    dbPath = join(dir, 'kobox.db');

    sh('bash', ['docker/e2e-setup.sh'], { env: process.env });

    // local TLS "tracker" answering openssl s_client on 127.0.0.2:8443
    const trackerKeys = generateCert(TRACKER_HOST, `DNS:${TRACKER_HOST}`);
    trackerTls = createTlsServer({ key: trackerKeys.key, cert: trackerKeys.cert });
    await new Promise<void>((resolve) => trackerTls?.listen(TRACKER_TLS_PORT, FIXTURE_IP, resolve));

    // local https server for the iblocklist catalog + the list bodies
    const listsKeys = generateCert(LISTS_HOST, `DNS:${LISTS_HOST}`);
    listsHttps = createHttpsServer(
      { key: listsKeys.key, cert: listsKeys.cert },
      (request, response) => {
        if (!listsServerUp) {
          request.destroy();
          return;
        }
        if (request.url?.startsWith('/lists.xml')) {
          response.writeHead(200);
          response.end(CATALOG_XML);
          return;
        }
        if (request.url?.startsWith('/?list=fixturelevel1id00000')) {
          response.writeHead(200);
          response.end(LIST_GZ);
          return;
        }
        response.writeHead(404);
        response.end();
      },
    );
    await new Promise<void>((resolve) => listsHttps?.listen(LISTS_PORT, FIXTURE_IP, resolve));

    env = {
      ...process.env,
      KOBOX_DB: dbPath,
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_BIN: `/usr/bin/env node ${process.cwd()}/${CLI}`,
      KOBOX_BLOCKLIST_CACHE: join(dir, 'blocklist_rtorrent.txt'),
      KOBOX_IBLOCKLIST_CATALOG_URL: `https://${LISTS_HOST}:${String(LISTS_PORT)}/lists.xml`,
      // trust seam for the https fixture (self-signed): node child processes
      // verify TLS against this CA in addition to the bundled store
      NODE_EXTRA_CA_CERTS: join(fixtureDir, `${LISTS_HOST}.pem`),
    };

    rmSync(PEM_PATH, { force: true });
    for (const path of [ALLOW_P2P, ZONES, BLOCKED_NAMES]) {
      rmSync(path, { force: true });
    }
    try {
      execFileSync('systemctl', ['disable', '--now', `rtorrent-${USER}`], { stdio: 'ignore' });
    } catch {
      // unit may not exist yet
    }
    try {
      execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
    } catch {
      // user may not exist yet
    }
  }, 60_000);

  afterAll(() => {
    trackerTls?.close();
    listsHttps?.close();
  });

  it('should_discover_the_tracker_from_a_real_insert_and_fetch_its_cert', async () => {
    kobox(['create-user', USER, '--email', 'e2e@example.org', '--quota-gib', '5'], 'pw123456\n');
    await drainQueue(); // create-user + chained provision
    await waitForScgi(20_000);

    const fixture = aTorrentFile({
      name: 'private-linux.iso',
      isPrivate: true,
      announce: `https://${TRACKER_HOST}:${String(TRACKER_TLS_PORT)}/announce/secret`,
    });
    const torrentPath = join(HOME, 'rtorrent/torrents/private-linux.iso.torrent');
    writeFileSync(torrentPath, fixture.data);
    sh('chown', [`${USER}:kobox-users`, torrentPath]);
    sh('runuser', ['-u', USER, '--', 'sh', join(HOME, '.rTorrent_inserted_new.sh'),
      fixture.infoHash, 'private-linux.iso', `${HOME}/rtorrent/complete`, torrentPath,
      `${HOME}/rtorrent/torrents`, '']);
    await drainQueue(); // event -> discover -> fetch-cert -> render-whitelist chain

    const tracker = dbRow('SELECT * FROM trackers WHERE host = ?', TRACKER_HOST);
    expect(tracker?.privacy).toBe('private');
    expect(tracker?.is_ssl).toBe(1);
    expect(tracker?.proto).toBe('https');
    expect(tracker?.port).toBe(TRACKER_TLS_PORT);
    expect(tracker?.check_state).toBe('none');
    expect(String(tracker?.cert_expiration)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(readFileSync(PEM_PATH, 'utf8')).toContain('BEGIN CERTIFICATE');
    expect(dbRow('SELECT ipv4 FROM tracker_ipv4')?.ipv4).toBe(FIXTURE_IP);
  }, 60_000);

  it('should_render_the_whitelist_files_with_users_and_trackers', async () => {
    kobox(['add-user-address', USER, '198.51.100.7']);
    await drainQueue(); // address job + chained render-whitelist

    const allow = readFileSync(ALLOW_P2P, 'utf8');
    expect(allow).toContain(`${USER}:198.51.100.7-255.255.255.255`);
    expect(allow).toContain(`${TRACKER_HOST}:${FIXTURE_IP}-255.255.255.255`);
    expect(readFileSync(ZONES, 'utf8')).not.toContain(TRACKER_HOST); // active tracker
    expect(readFileSync(BLOCKED_NAMES, 'utf8')).not.toContain(TRACKER_HOST);
  });

  it('should_be_idempotent_on_a_forced_whitelist_render', async () => {
    const before = statSync(ALLOW_P2P).mtimeMs;

    kobox(['render-whitelist']);
    await drainQueue();

    // unchanged content -> write-if-changed left the file untouched
    expect(statSync(ALLOW_P2P).mtimeMs).toBe(before);
  });

  it('should_renew_a_due_certificate_via_the_cron_entry_point', async () => {
    dbRun('UPDATE trackers SET cert_expiration = ? WHERE host = ?', '2026-01-01', TRACKER_HOST);

    kobox(['renew-tracker-certs']);
    await drainQueue();

    const tracker = dbRow('SELECT * FROM trackers WHERE host = ?', TRACKER_HOST);
    expect(tracker?.is_ssl).toBe(1);
    expect(String(tracker?.cert_expiration) > '2026-01-01').toBe(true); // re-fetched
    expect(tracker?.check_state).toBe('none');
  });

  it('should_flow_verified_blocklists_into_a_filter_a_real_rtorrent_parses', async () => {
    kobox(['import-blocklist-catalog']);
    await drainQueue();
    const imported = dbRow('SELECT * FROM blocklists WHERE name = ?', 'level1');
    expect(imported?.enabled).toBe(1); // curated default
    expect(String(imported?.url)).toContain('list.iblocklist.com'); // catalog URL rewritten https
    // point the download at the local fixture (operator-editable URL in DB)
    dbRun(
      'UPDATE blocklists SET url = ? WHERE name = ?',
      `https://${LISTS_HOST}:${String(LISTS_PORT)}/?list=fixturelevel1id00000&fileformat=p2p&archiveformat=gz`,
      'level1',
    );

    kobox(['update-blocklists']);
    await drainQueue(); // update + chained render-blocklist-filters

    const updated = dbRow('SELECT * FROM blocklists WHERE name = ?', 'level1');
    expect(updated?.last_update_status).toBe('ok');
    expect(String(updated?.sha256)).toHaveLength(64);
    const filter = readFileSync(join(HOME, 'blocklist/blocklist_rtorrent.txt'), 'utf8');
    expect(filter).toBe('10.9.0.0-10.9.255.255\n192.0.2.0-192.0.2.255\n');
    expect(readFileSync(join(HOME, 'rtorrent/config.d/80-blocklist.rc'), 'utf8')).toContain(
      'ipv4_filter.load',
    );

    // a real rtorrent must accept the drop-in + filter file
    sh('systemctl', ['restart', `rtorrent-${USER}`]);
    await waitForScgi(20_000);
    expect(unitProperty('ActiveState')).toBe('active');
  }, 60_000);

  it('should_keep_the_last_good_blocklist_when_the_source_dies', async () => {
    listsServerUp = false;
    const filterBefore = readFileSync(join(HOME, 'blocklist/blocklist_rtorrent.txt'), 'utf8');

    kobox(['update-blocklists']);
    await drainQueue(); // must stay green: failure is isolated, not fatal

    const row = dbRow('SELECT * FROM blocklists WHERE name = ?', 'level1');
    expect(row?.last_update_status).toBe('failed');
    expect(String(row?.sha256)).toHaveLength(64); // last good hash kept
    expect(readFileSync(join(HOME, 'blocklist/blocklist_rtorrent.txt'), 'utf8')).toBe(
      filterBefore,
    );
    listsServerUp = true;
  }, 60_000);

  it('should_blacklist_a_dead_tracker_everywhere', async () => {
    kobox(['mark-tracker-dead', TRACKER_HOST]);
    await drainQueue(); // mark + chained render-whitelist

    const tracker = dbRow('SELECT * FROM trackers WHERE host = ?', TRACKER_HOST);
    expect(tracker?.is_dead).toBe(1);
    expect(tracker?.is_active).toBe(0);
    expect(readFileSync(ZONES, 'utf8')).toContain(
      `zone "${TRACKER_HOST}" { type master; file "/etc/bind/db.empty"; };`,
    );
    expect(readFileSync(BLOCKED_NAMES, 'utf8')).toContain(TRACKER_HOST);
    expect(readFileSync(ALLOW_P2P, 'utf8')).not.toContain(TRACKER_HOST);
    expect(existsSync(PEM_PATH)).toBe(false);
  });

  it('should_report_the_tracker_in_the_operator_view', () => {
    const listed = JSON.parse(kobox(['list-trackers'])) as { host: string; dead: boolean }[];
    const entry = listed.find((row) => row.host === TRACKER_HOST);
    expect(entry?.dead).toBe(true);
  });

  it('should_clean_up_on_delete', async () => {
    kobox(['delete-user', USER]);
    await drainQueue();
    expect(dbRow('SELECT id FROM torrent_instances WHERE username = ?', USER)).toBeUndefined();
  });
});
