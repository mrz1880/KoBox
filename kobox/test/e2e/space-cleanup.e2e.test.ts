import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aTorrentFile } from '../builders/TorrentFileBuilder.js';
import { DEFAULT_SPOOL_DIR } from '../../src/infrastructure/spool/TorrentEventSpool.js';
import { scgiCall, waitForScgi } from './support/scgi.js';

// Space cleanup on a fresh Debian 13 with a REAL rtorrent: a finished torrent
// whose copy KoBox sync already sent is proposed by the hourly sample, then
// the clean-up-space job erases it from rtorrent and deletes its files as the
// member. Requires: pnpm build, root, systemd, rtorrent (make e2e runs it).

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const USER = 'e2ecleanup';
const HOME = `/home/${USER}`;
const COMPLETE = join(HOME, 'rtorrent/complete');
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';
const SCGI_PORT = 51101; // first allocation on a fresh DB

// several pieces, the last one short: rtorrent checks every one of them
const CONTENT = Buffer.alloc(600 * 1024, 'alice');
const RELEASE = 'Some.Sent.Release.2026.mkv';
const torrent = aTorrentFile({ name: RELEASE, isPrivate: true, content: CONTENT });
const DATA_PATH = join(COMPLETE, RELEASE);

let env: NodeJS.ProcessEnv;
let dbPath: string;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

function drainQueue(overrides: NodeJS.ProcessEnv = {}): void {
  sh('node', [WORKER, '--once'], { env: { ...env, ...overrides } });
}

// rtorrent's shims spool where a real box's worker sweeps, not in this suite's
// spool: sweeping it here keeps this member's events out of later suites
function drainRtorrentEvents(): void {
  drainQueue({ KOBOX_SPOOL: DEFAULT_SPOOL_DIR });
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

// The hashes rtorrent lists in its `complete` view: its own answer, not KoBox's
async function completeHashes(): Promise<string[]> {
  const response = await scgiCall(SCGI_PORT, 'd.multicall2', ['', 'complete', 'd.hash=']);
  return [...response.matchAll(/<string>([0-9A-F]{40})<\/string>/g)].map((match) => match[1] ?? '');
}

async function eventually(assertion: () => Promise<void>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function removeMember(): void {
  try {
    execFileSync('systemctl', ['disable', '--now', `rtorrent-${USER}`], { stdio: 'ignore' });
  } catch {
    // unit may not exist
  }
  try {
    execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
  } catch {
    // user may not exist
  }
}

describe.skipIf(!onDebianAsRoot)('E2E: space cleanup with a real rtorrent', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-cleanup-e2e-'));
    chmodSync(dir, 0o711); // the seedbox user must traverse into the spool
    dbPath = join(dir, 'kobox.db');
    env = {
      ...process.env,
      KOBOX_DB: dbPath,
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_BIN: `/usr/bin/env node ${process.cwd()}/${CLI}`,
    };
    sh('bash', ['docker/e2e-setup.sh']);
    removeMember();

    kobox(['create-user', USER, '--email', 'alice@example.org', '--quota-gib', '5'], 'pw123456\n');
    drainQueue(); // create-user then the chained provision-rtorrent
    await waitForScgi(SCGI_PORT, 20_000);
  }, 120_000);

  afterAll(() => {
    try {
      kobox(['delete-user', USER]);
      drainQueue();
      drainRtorrentEvents();
    } finally {
      // whatever went wrong above, no rtorrent of this suite squats the port
      // the next suite allocates first
      removeMember();
    }
  });

  it('should_give_back_the_space_of_a_torrent_already_sent_to_the_member', async () => {
    // a download finished long ago: its data under complete/, owned by the
    // member as rtorrent would have left it
    writeFileSync(DATA_PATH, CONTENT);
    sh('chown', [`${USER}:${USER}`, DATA_PATH]);
    const torrentFile = join(HOME, 'rtorrent/torrents', `${RELEASE}.torrent`);
    writeFileSync(torrentFile, torrent.data);
    sh('chown', [`${USER}:kobox-users`, torrentFile]);

    // rtorrent loads it next to its data, checks every piece and lists it
    // complete. It never saw it finish: it counts from when it loaded it.
    await scgiCall(SCGI_PORT, 'load.start', ['', torrentFile, `d.directory.set=${COMPLETE}/`]);
    await eventually(async () => {
      expect(await completeHashes()).toContain(torrent.infoHash);
    }, 30_000);
    drainRtorrentEvents();

    // A fresh torrent has seeded nothing, and the seed rule asks for a ratio
    // above 0 over at least a day: no honest rule passes it today. What does
    // is a copy already on the member's machine. That KoBox sync really
    // carries one there is proven by torrent-lifecycle; here the transfer it
    // leaves behind is written down as it would be.
    dbRun(
      `INSERT INTO sync_transfers (username, label, source, state, attempts, queued_at, updated_at)
       VALUES (?, '', ?, 'sent', 1, ?, ?)`,
      USER,
      DATA_PATH,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    kobox(['sample-disk-usage']);

    const candidate = dbRow(
      'SELECT name, size_bytes, path, reason FROM cleanup_candidates WHERE username = ? AND info_hash = ?',
      USER,
      torrent.infoHash,
    );
    expect(candidate).toEqual({
      name: RELEASE,
      size_bytes: CONTENT.length,
      path: DATA_PATH,
      reason: 'alreadySent',
    });

    // what the portal enqueues when the member ticks it and confirms
    dbRun(
      'INSERT INTO jobs (type, payload_json) VALUES (?, ?)',
      'clean-up-space',
      JSON.stringify({ username: USER, infoHashes: [torrent.infoHash] }),
    );
    drainQueue();

    const job = dbRow("SELECT status, error FROM jobs WHERE type = 'clean-up-space'");
    expect(job?.status, String(job?.error)).toBe('done');
    // rtorrent no longer knows it, and its files are gone from the disk
    const state = await scgiCall(SCGI_PORT, 'd.state', [torrent.infoHash]);
    expect(state).toContain('<fault>');
    expect(await completeHashes()).not.toContain(torrent.infoHash);
    expect(existsSync(DATA_PATH)).toBe(false);
    // the member reads what went
    const report = dbRow('SELECT report_json FROM cleanup_reports WHERE username = ?', USER);
    expect(JSON.parse(String(report?.report_json))).toEqual({
      deleted: [{ name: RELEASE, sizeBytes: CONTENT.length }],
      skipped: [],
    });
    // and the snapshot taken again no longer proposes it
    expect(
      dbRow(
        'SELECT name FROM cleanup_candidates WHERE username = ? AND info_hash = ?',
        USER,
        torrent.infoHash,
      ),
    ).toBeUndefined();
  }, 120_000);
});
