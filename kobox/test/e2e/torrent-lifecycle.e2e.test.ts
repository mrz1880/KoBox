import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import { aTorrentFile } from '../builders/TorrentFileBuilder.js';

// Full Phase 1 E2E on a fresh Debian 12 with a REAL rtorrent:
// provision -> config validated by rtorrent itself -> declarative re-render
// -> event shims -> spool -> root worker -> DB flags respected.
// Requires: pnpm build, root, systemd, rtorrent (make e2e runs it).

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const USER = 'e2etorrent';
const HOME = `/home/${USER}`;
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';
const SCGI_PORT = 51101; // first allocation on a fresh DB

let env: NodeJS.ProcessEnv;
let dbPath: string;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

function drainQueue(): void {
  sh('node', [WORKER, '--once']);
}

function unitProperty(name: string): string {
  return sh('systemctl', ['show', '-p', name, '--value', `rtorrent-${USER}`]).trim();
}

function dbRow(query: string, ...params: string[]): Record<string, unknown> | undefined {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(query).get(...params) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
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
          reject(new Error(`rtorrent SCGI port ${String(SCGI_PORT)} never came up`));
          return;
        }
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function markerCount(): number {
  try {
    return readFileSync(join(HOME, 'e2e-marker'), 'utf8').trim().split('\n').filter(Boolean)
      .length;
  } catch {
    return 0;
  }
}

const FINISHED_HASH = 'A1B2C3D4E5F6A7B8C9D0A1B2C3D4E5F6A7B8C9D0';

describe.skipIf(!onDebianAsRoot)('E2E: torrent lifecycle with a real rtorrent', () => {
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-torrent-e2e-'));
    chmodSync(dir, 0o711); // the seedbox user must traverse into the spool
    dbPath = join(dir, 'kobox.db');
    env = {
      ...process.env,
      KOBOX_DB: dbPath,
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_BIN: `/usr/bin/env node ${process.cwd()}/${CLI}`,
    };
    sh('bash', ['docker/e2e-setup.sh']);
    // This suite never runs `kobox install`, so it lays down what the rtorrent
    // component would have: rsync and sshpass are what carry a download across.
    // That the INSTALLER really provides them is asserted in installation.e2e.
    sh(
      'sh',
      [
        '-c',
        'DEBIAN_FRONTEND=noninteractive apt-get update -qq && ' +
          'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync sshpass',
      ],
      { stdio: 'ignore' },
    );
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
  });

  it('should_provision_an_instance_whose_config_a_real_rtorrent_accepts', async () => {
    kobox(['create-user', USER, '--email', 'e2e@example.org', '--quota-gib', '5'], 'pw123456\n');
    drainQueue(); // create-user then the chained provision-rtorrent

    const rc = readFileSync(join(HOME, '.rtorrent.rc'), 'utf8');
    expect(rc).toContain(`network.scgi.open_port = 127.0.0.1:${String(SCGI_PORT)}`);
    expect(rc).toContain('system.daemon.set = true');
    expect(readFileSync(join(HOME, '.rTorrent_finished.sh'), 'utf8')).toContain(
      'torrent-event finished',
    );
    expect(existsSync(join(HOME, 'rtorrent/config.d/80-watch.rc'))).toBe(true);

    expect(unitProperty('ActiveState')).toBe('active');
    await waitForScgi(20_000); // rtorrent parsed our config and opened SCGI
  });

  it('should_rerender_idempotently_leaving_user_dropins_and_the_process_alone', () => {
    const startedAt = unitProperty('ActiveEnterTimestampMonotonic');
    const rcBefore = readFileSync(join(HOME, '.rtorrent.rc'), 'utf8');
    const dropIn = join(HOME, 'rtorrent/config.d/99-user.rc');
    writeFileSync(dropIn, '# user tweak, must survive renders\n');

    kobox(['render-rtorrent-config', USER]);
    drainQueue();

    expect(readFileSync(join(HOME, '.rtorrent.rc'), 'utf8')).toBe(rcBefore);
    expect(readFileSync(dropIn, 'utf8')).toBe('# user tweak, must survive renders\n');
    // unchanged content -> no restart (the anti-restart-storm guarantee)
    expect(unitProperty('ActiveEnterTimestampMonotonic')).toBe(startedAt);
  });

  it('should_add_a_watch_dir_and_restart_into_the_new_schedule', async () => {
    const startedAt = unitProperty('ActiveEnterTimestampMonotonic');

    kobox(['add-watch-dir', USER, 'films']);
    drainQueue();

    const watchRc = readFileSync(join(HOME, 'rtorrent/config.d/80-watch.rc'), 'utf8');
    expect(watchRc).toContain('d.custom1.set=films');
    expect(existsSync(join(HOME, 'rtorrent/watch/films'))).toBe(true);
    expect(unitProperty('ActiveState')).toBe('active');
    expect(unitProperty('ActiveEnterTimestampMonotonic')).not.toBe(startedAt); // restarted
    await waitForScgi(20_000);
  });

  it('should_remember_what_a_category_does_with_a_finished_download', () => {
    // the mode lives in the database, not in a rendered file: it must survive
    // an rtorrent restart and be readable back exactly as it was set
    kobox(['set-category-sync-mode', USER, 'films', 'immediate']);
    drainQueue();

    const row = dbRow('SELECT sync_mode FROM watch_dirs WHERE label = ?', 'films');
    expect(row?.sync_mode).toBe('immediate');
  });

  it('should_reach_a_real_ssh_target_with_a_sealed_password_and_record_the_verdict', () => {
    // A real destination, end to end: RSA seals the password, the ROOT worker
    // opens it, sshpass -e hands it to a real sshd over a real socket, and the
    // remote folder is really tested for writability. The only thing standing in
    // for the member's NAS is a second account on this box.
    const TARGET = 'e2esynctarget';
    const SECRET = 'nas-password-42';
    // leftovers from an earlier run must not shadow this one
    try {
      sh('userdel', ['-r', TARGET], { stdio: 'ignore' });
    } catch {
      /* absent */
    }
    sh('useradd', ['--create-home', '--shell', '/bin/sh', TARGET]);
    sh('chpasswd', [], { input: `${TARGET}:${SECRET}\n` });
    sh('install', ['-d', '-o', TARGET, '-g', TARGET, `/home/${TARGET}/incoming`]);
    // the host key pair the portal seals with — install normally lays it down
    sh('mkdir', ['-p', '/etc/kobox']);
    sh('openssl', ['genrsa', '-out', '/etc/kobox/debrid-key.pem', '4096'], { stdio: 'pipe' });
    sh('sh', ['-c', 'openssl rsa -in /etc/kobox/debrid-key.pem -pubout -out /etc/kobox/debrid-pub.pem']);

    kobox(
      [
        'set-sync-destination', USER, '127.0.0.1', '22', TARGET, `/home/${TARGET}/incoming`,
      ],
      `${SECRET}\n`,
    );
    kobox(['check-sync-destination', USER]);
    drainQueue();

    const row = dbRow('SELECT last_check_ok, last_check_detail, sealed_password FROM sync_destinations WHERE username = ?', USER);
    expect(row?.last_check_ok, String(row?.last_check_detail)).toBe(1);
    // never stored in the clear, whatever else happens
    expect(String(row?.sealed_password)).not.toContain(SECRET);
    // first sight pinned the key rather than accepting anything that answers
    expect(existsSync(`/var/lib/kobox/sync/${USER}.known_hosts`)).toBe(true);
  }, 120_000);

  it('should_say_what_is_wrong_rather_than_just_failing', () => {
    // same account, a folder it cannot write to: the member needs to know it is
    // the folder, not the password
    kobox(
      ['set-sync-destination', USER, '127.0.0.1', '22', 'e2esynctarget', '/root/nope'],
      'nas-password-42\n',
    );
    kobox(['check-sync-destination', USER]);
    drainQueue();

    const row = dbRow('SELECT last_check_ok, last_check_detail FROM sync_destinations WHERE username = ?', USER);
    expect(row?.last_check_ok).toBe(0);
    expect(String(row?.last_check_detail)).toContain('folder');
  }, 60_000);

  it('should_carry_a_finished_download_to_a_real_machine_over_a_real_connection', () => {
    // The whole chain, nothing stubbed: rTorrent's own shim fires as the member,
    // the category's mode decides, the sealed password is opened by the root
    // worker, rsync goes over a real ssh connection to a real sshd, and the file
    // lands in a folder named after the category on the other side.
    const TARGET = 'e2esynctarget';
    const inbox = `/home/${TARGET}/incoming`;
    kobox(['set-sync-destination', USER, '127.0.0.1', '22', TARGET, inbox], 'nas-password-42\n');
    kobox(['set-category-sync-mode', USER, 'films', 'immediate']);
    drainQueue();

    // a real file where a real finished download would have left one
    const completed = join(HOME, 'rtorrent/complete/films');
    sh('install', ['-d', '-o', USER, '-g', USER, completed]);
    const payload = join(completed, 'Some.Release.2026.mkv');
    writeFileSync(payload, 'x'.repeat(4096));
    sh('chown', [`${USER}:${USER}`, payload]);

    sh('runuser', [
      '-u',
      USER,
      '--',
      'sh',
      join(HOME, '.rTorrent_finished.sh'),
      'c'.repeat(40),
      payload,
      completed,
      'Some.Release.2026.mkv',
      '',
      'films',
    ]);
    // the spool sweep runs the event, which queues the transfer and chains the
    // immediate pass: one drain per step
    drainQueue();
    drainQueue();
    drainQueue();

    const row = dbRow('SELECT state, last_error FROM sync_transfers WHERE username = ?', USER);
    expect(row?.state, String(row?.last_error)).toBe('sent');
    // and it is really there, with its bytes, under a folder named after the
    // category — the layout members' machines already assume
    const landed = `${inbox}/films/Some.Release.2026.mkv`;
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, 'utf8')).toHaveLength(4096);
  }, 120_000);

  it('should_process_a_finished_event_from_the_real_shim_and_fan_out_user_scripts', () => {
    sh('install', ['-d', '-o', USER, '-g', 'kobox-users', join(HOME, 'scripts')]);
    writeFileSync(
      join(HOME, 'scripts/e2emark.sh'),
      `#!/bin/sh\necho "$1" >> ${HOME}/e2e-marker\n`,
    );
    sh('chown', [`${USER}:${USER}`, join(HOME, 'scripts/e2emark.sh')]);
    sh('chmod', ['0755', join(HOME, 'scripts/e2emark.sh')]);

    sh('runuser', [
      '-u',
      USER,
      '--',
      'sh',
      join(HOME, '.rTorrent_finished.sh'),
      FINISHED_HASH,
      `${HOME}/rtorrent/complete/films/x`,
      `${HOME}/rtorrent/complete/films`,
      'x',
      '',
      'films',
    ]);
    drainQueue(); // sweeps the spool, executes the torrent-event job

    const row = dbRow(
      'SELECT state, tree, label FROM torrents WHERE username = ? AND info_hash = ?',
      USER,
      FINISHED_HASH,
    );
    expect(row?.state).toBe('completed');
    expect(row?.tree).toBe(`${HOME}/rtorrent/complete/films/x`);
    expect(row?.label).toBe('films');
    expect(markerCount()).toBe(1); // user script ran, as the user
  });

  it('should_respect_the_sync_disabled_flag_on_the_next_finished_event', () => {
    kobox(['set-sync-disabled', USER, 'on']);
    drainQueue();

    sh('runuser', [
      '-u',
      USER,
      '--',
      'sh',
      join(HOME, '.rTorrent_finished.sh'),
      FINISHED_HASH,
      `${HOME}/rtorrent/complete/films/x`,
      `${HOME}/rtorrent/complete/films`,
      'x',
      '',
      'films',
    ]);
    drainQueue();

    expect(markerCount()).toBe(1); // no new fan-out: flag honored from the DB
  });

  it('should_reject_public_trackers_until_the_per_user_flag_allows_them', () => {
    const fixture = aTorrentFile({ name: 'public-linux.iso', isPrivate: false });
    const torrentPath = join(HOME, 'rtorrent/torrents/public-linux.iso.torrent');
    writeFileSync(torrentPath, fixture.data);
    sh('chown', [`${USER}:kobox-users`, torrentPath]);
    const insertedArgs = [
      fixture.infoHash,
      'public-linux.iso',
      `${HOME}/rtorrent/complete`,
      torrentPath,
      `${HOME}/rtorrent/torrents`,
      '',
    ];

    sh('runuser', ['-u', USER, '--', 'sh', join(HOME, '.rTorrent_inserted_new.sh'), ...insertedArgs]);
    drainQueue();
    let row = dbRow(
      'SELECT state FROM torrents WHERE username = ? AND info_hash = ?',
      USER,
      fixture.infoHash,
    );
    expect(row?.state).toBe('rejected');

    kobox(['set-allow-public-tracker', USER, 'on']);
    drainQueue();
    sh('runuser', ['-u', USER, '--', 'sh', join(HOME, '.rTorrent_inserted_new.sh'), ...insertedArgs]);
    drainQueue();
    row = dbRow(
      'SELECT state FROM torrents WHERE username = ? AND info_hash = ?',
      USER,
      fixture.infoHash,
    );
    expect(row?.state).toBe('loaded');
  });

  it('should_early_exit_on_an_inserted_event_without_torrent_file', () => {
    const hash = 'B1B2C3D4E5F6A7B8C9D0A1B2C3D4E5F6A7B8C9D0';
    sh('runuser', [
      '-u',
      USER,
      '--',
      'sh',
      join(HOME, '.rTorrent_inserted_new.sh'),
      hash,
      'magnet-add',
      `${HOME}/rtorrent/complete`,
      '', // no loaded file: the ex-Radarr crash case
      '',
      '',
    ]);
    drainQueue();

    const row = dbRow(
      'SELECT state FROM torrents WHERE username = ? AND info_hash = ?',
      USER,
      hash,
    );
    expect(row).toBeUndefined(); // native early-exit: no row, no crash, job done
  });

  it('should_deprovision_everything_on_delete', () => {
    kobox(['delete-user', USER]);
    drainQueue();

    expect(existsSync(`/etc/systemd/system/rtorrent-${USER}.service`)).toBe(false);
    expect(unitProperty('ActiveState')).not.toBe('active');
    expect(dbRow('SELECT id FROM torrent_instances WHERE username = ?', USER)).toBeUndefined();
    expect(dbRow('SELECT id FROM torrents WHERE username = ?', USER)).toBeUndefined();
  });
});
