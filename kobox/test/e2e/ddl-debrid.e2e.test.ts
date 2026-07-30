import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderAria2Conf, renderAria2Unit } from '../../src/domain/installation/rendering.js';

// Full DDL/debrid E2E on a fresh Debian 12 with a REAL aria2c daemon started
// from the REAL rendered unit + config (the kobox-aria2 non-root account, RPC
// on loopback with a config-borne secret). A local stub stands in for AllDebrid
// (unreachable in CI) and for the filehoster: the flow is
//   request-download (CLI) -> worker unlock(stub) -> aria2 fetch(stub file)
//   -> scheduled poll -> root worker places the file in ~user/rtorrent/complete
// and hands it to the user — exactly the plumbing the real box runs, minus the
// real debrid call (which the integration test covers against a stub).

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const USER = 'e2eddl';
const HOME = `/home/${USER}`;
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';
const CONF = '/etc/kobox/aria2.conf';
const UNIT = '/etc/systemd/system/kobox-aria2.service';
const STAGING = '/var/lib/kobox/ddl-staging';
const RPC_SECRET = 'e2e-aria2-rpc-secret';
const PAYLOAD = 'kobox-ddl-e2e-payload\n';

let env: NodeJS.ProcessEnv;
let dbPath: string;
let stub: Server;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

function drainQueue(): void {
  sh('node', [WORKER, '--once']);
}

function dbRow(query: string, ...params: string[]): Record<string, unknown> | undefined {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(query).get(...params) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

function ensureAccount(): void {
  try {
    execFileSync('groupadd', ['--system', 'kobox-aria2'], { stdio: 'ignore' });
  } catch {
    /* already exists */
  }
  try {
    execFileSync(
      'useradd',
      ['--system', '--gid', 'kobox-aria2', '--no-create-home', '--shell', '/usr/sbin/nologin', 'kobox-aria2'],
      { stdio: 'ignore' },
    );
  } catch {
    /* already exists */
  }
}

// A single stub for both AllDebrid and the filehoster: /v4/link/unlock returns a
// direct link back to /file on this same server; /file streams the payload.
function startStub(): Promise<number> {
  return new Promise((resolve) => {
    stub = createServer((req, res) => {
      const { port } = stub.address() as AddressInfo;
      if (req.url?.startsWith('/v4/link/unlock')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: { link: `http://127.0.0.1:${String(port)}/file/movie.mkv`, filename: 'movie.mkv' },
          }),
        );
        return;
      }
      if (req.url?.startsWith('/file/')) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(PAYLOAD);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    stub.listen(0, '127.0.0.1', () => {
      resolve((stub.address() as AddressInfo).port);
    });
  });
}

describe.skipIf(!onDebianAsRoot)('E2E: debrid link -> aria2 -> user home', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-ddl-e2e-'));
    dbPath = join(dir, 'kobox.db');
    const stubPort = await startStub();
    env = {
      ...process.env,
      KOBOX_DB: dbPath,
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_BIN: `/usr/bin/env node ${process.cwd()}/${CLI}`,
      KOBOX_ALLDEBRID_APIKEY: 'e2e-key',
      KOBOX_ALLDEBRID_BASE_URL: `http://127.0.0.1:${String(stubPort)}`,
      KOBOX_ARIA2_RPC_URL: 'http://127.0.0.1:6800/jsonrpc',
      KOBOX_ARIA2_RPC_SECRET: RPC_SECRET,
      KOBOX_DDL_STAGING: STAGING,
    };
    sh('bash', ['docker/e2e-setup.sh']);
    try {
      execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
    } catch {
      /* user may not exist yet */
    }

    // the REAL rendered aria2 config + unit — what `kobox install` writes
    ensureAccount();
    sh('install', ['-d', '-o', 'kobox-aria2', '-g', 'kobox-aria2', STAGING]);
    writeFileSync(CONF, renderAria2Conf(RPC_SECRET, STAGING).content);
    execFileSync('chown', ['root:kobox-aria2', CONF]);
    execFileSync('chmod', ['0640', CONF]);
    writeFileSync(UNIT, renderAria2Unit(STAGING).content);
    execFileSync('systemctl', ['daemon-reload']);
    execFileSync('systemctl', ['enable', '--now', 'kobox-aria2'], { stdio: 'ignore' });
    for (let i = 0; i < 25; i += 1) {
      if (sh('ss', ['-ltnH']).includes('127.0.0.1:6800')) {
        break;
      }
      await sleep(200);
    }

    // a real seedbox user so placement has a home to land in
    kobox(['create-user', USER, '--email', 'e2eddl@example.org', '--quota-gib', '5'], 'pw123456\n');
    drainQueue();
  });

  afterAll(() => {
    stub.close();
    try {
      execFileSync('systemctl', ['disable', '--now', 'kobox-aria2'], { stdio: 'ignore' });
    } catch {
      /* not started */
    }
    try {
      execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  });

  it('should_run_aria2_as_the_dedicated_account_on_loopback', () => {
    expect(sh('systemctl', ['is-active', 'kobox-aria2']).trim()).toBe('active');
    expect(sh('systemctl', ['show', '-p', 'User', '--value', 'kobox-aria2']).trim()).toBe(
      'kobox-aria2',
    );
    const listeners = sh('ss', ['-ltnH']);
    expect(listeners).toContain('127.0.0.1:6800');
    expect(listeners).not.toContain('0.0.0.0:6800');
  });

  it('should_carry_a_link_through_debrid_and_aria2_into_the_user_home', async () => {
    kobox([
      'request-download',
      USER,
      'https://1fichier.example/abc',
      '--category',
      'films',
    ]);
    drainQueue(); // StartDebridDownload: unlock(stub) + aria2 addUri

    let status = '';
    for (let i = 0; i < 40 && status !== 'done'; i += 1) {
      kobox(['poll-debrid-downloads']);
      drainQueue(); // PollDebridDownloads: place on complete
      const current = dbRow('SELECT status FROM debrid_downloads WHERE username = ?', USER)?.status;
      status = typeof current === 'string' ? current : '';
      if (status === 'failed') {
        break;
      }
      await sleep(250);
    }

    const row = dbRow(
      'SELECT status, filename FROM debrid_downloads WHERE username = ?',
      USER,
    );
    expect(row?.status).toBe('done');
    expect(row?.filename).toBe('movie.mkv');

    const placed = join(HOME, 'rtorrent/complete/films/movie.mkv');
    expect(readFileSync(placed, 'utf8')).toBe(PAYLOAD);
    // handed to the user, not left owned by root or kobox-aria2
    expect(sh('stat', ['-c', '%U', placed]).trim()).toBe(USER);
  });

  it('should_mark_the_row_failed_when_the_debrid_call_rejects', () => {
    // point the debrid at a dead port: unlock fails, the row fails, nothing hangs
    const failEnv = { ...env, KOBOX_ALLDEBRID_BASE_URL: 'http://127.0.0.1:1' };
    execFileSync('node', [CLI, 'request-download', USER, 'https://1fichier.example/dead', '--category', 'series'], {
      encoding: 'utf8',
      env: failEnv,
    });
    execFileSync('node', [WORKER, '--once'], { encoding: 'utf8', env: failEnv });

    const row = dbRow(
      "SELECT status, error FROM debrid_downloads WHERE username = ? AND category = 'series'",
      USER,
    );
    expect(row?.status).toBe('failed');
    // the sanitized adapter message, never the key
    expect(String(row?.error)).not.toContain('e2e-key');
  });
});
