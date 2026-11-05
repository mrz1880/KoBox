import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import { aTorrentFile } from '../builders/TorrentFileBuilder.js';
import { DEFAULT_SPOOL_DIR } from '../../src/infrastructure/spool/TorrentEventSpool.js';
import { openString } from '../../src/infrastructure/system/rsaSealing.js';
import { scgiCall, waitForScgi } from './support/scgi.js';

// Full Phase 1 E2E on a fresh Debian 13 with a REAL rtorrent:
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
let hostKey: string;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

function drainQueue(overrides: NodeJS.ProcessEnv = {}): void {
  sh('node', [WORKER, '--once'], { env: { ...env, ...overrides } });
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

// d.state as rtorrent reports it: 1 started, 0 stopped, undefined not loaded
async function rtorrentState(infoHash: string): Promise<number | undefined> {
  const response = await scgiCall(SCGI_PORT, 'd.state', [infoHash]);
  if (response.includes('<fault>')) {
    return undefined;
  }
  const value = /<(?:i4|i8|int)>(\d+)<\//.exec(response)?.[1];
  return value === undefined ? undefined : Number(value);
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

function markerCount(): number {
  try {
    return readFileSync(join(HOME, 'e2e-marker'), 'utf8').trim().split('\n').filter(Boolean)
      .length;
  } catch {
    return 0;
  }
}

// A real file where a real finished download of the films folder would have
// left one, announced by rTorrent's own shim, then the spool sweep, the event
// that queues the transfer and the immediate pass it chains: one drain per step
function finishDownload(name: string, infoHash: string): void {
  const completed = join(HOME, 'rtorrent/complete/films');
  sh('install', ['-d', '-o', USER, '-g', USER, completed]);
  const payload = join(completed, name);
  writeFileSync(payload, 'x'.repeat(4096));
  sh('chown', [`${USER}:${USER}`, payload]);
  sh('runuser', [
    '-u', USER, '--', 'sh', join(HOME, '.rTorrent_finished.sh'),
    infoHash, payload, completed, name, '', 'films',
  ]);
  drainQueue();
  drainQueue();
  drainQueue();
}

const FINISHED_HASH = 'A1B2C3D4E5F6A7B8C9D0A1B2C3D4E5F6A7B8C9D0';

describe.skipIf(!onDebianAsRoot)('E2E: torrent lifecycle with a real rtorrent', () => {
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-torrent-e2e-'));
    chmodSync(dir, 0o711); // the seedbox user must traverse into the spool
    dbPath = join(dir, 'kobox.db');
    // a key pair of its own, handed over through the KOBOX_DEBRID_*_KEY
    // overrides: the host pair that e2e-setup lays down is never rewritten from
    // here
    hostKey = join(dir, 'host-key.pem');
    execFileSync('openssl', ['genrsa', '-out', hostKey, '4096'], { stdio: 'pipe' });
    execFileSync('openssl', ['rsa', '-in', hostKey, '-pubout', '-out', join(dir, 'host-pub.pem')], {
      stdio: 'pipe',
    });
    env = {
      ...process.env,
      KOBOX_DB: dbPath,
      KOBOX_DEBRID_PRIVATE_KEY: hostKey,
      KOBOX_DEBRID_PUBLIC_KEY: join(dir, 'host-pub.pem'),
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
    await waitForScgi(SCGI_PORT, 20_000); // rtorrent parsed our config and opened SCGI
  });

  it('should_keep_other_members_out_of_a_tree_the_web_server_can_reach', () => {
    // On the first production box any member could write into another's watch
    // folder and list their downloads (shared kobox-users group), while nginx
    // could not read a single finished file (rtorrent's UMask 0027).
    const neighbour = 'e2eneighbour';
    try {
      execFileSync('userdel', ['-r', neighbour], { stdio: 'ignore' });
    } catch {
      // not there yet
    }
    sh('useradd', ['-m', '-G', 'kobox-users', neighbour]);
    const finished = join(HOME, 'rtorrent/complete/finished.bin');
    // written the way rtorrent writes, under its UMask
    sh('runuser', ['-u', USER, '--', 'sh', '-c', `umask 0027 && echo data > ${finished}`]);
    const can = (user: string, command: string): boolean => {
      try {
        execFileSync('runuser', ['-u', user, '--', 'sh', '-c', command], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    };
    try {
      expect(can(neighbour, `touch ${join(HOME, 'rtorrent/watch/intruder.torrent')}`)).toBe(false);
      expect(can(neighbour, `ls ${join(HOME, 'rtorrent/complete')}`)).toBe(false);
      expect(can('www-data', `cat ${finished}`)).toBe(true);
      expect(can('www-data', `touch ${join(HOME, 'rtorrent/watch/from-the-web.torrent')}`)).toBe(true);
    } finally {
      execFileSync('userdel', ['-r', neighbour], { stdio: 'ignore' });
      sh('rm', ['-f', finished, join(HOME, 'rtorrent/watch/from-the-web.torrent')]);
    }
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
    await waitForScgi(SCGI_PORT, 20_000);
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
    // and sealed with the pair this box was told to use, not a default path
    const opened = openString(readFileSync(hostKey, 'utf8'), String(row?.sealed_password), 'password');
    expect(opened).toBe(SECRET);
    // first sight pinned the key rather than accepting anything that answers
    expect(existsSync(`/var/lib/kobox/sync/${USER}.known_hosts`)).toBe(true);
    // writing was proven with a folder of KoBox's own, gone again afterwards
    expect(readdirSync(`/home/${TARGET}/incoming`)).toEqual([]);
  }, 120_000);

  it('should_fail_the_check_for_a_folder_the_account_sees_but_cannot_write_in', () => {
    // seen on 2026-11-04: the account could list the folder, and every transfer
    // was refused right after a green check
    const TARGET = 'e2esynctarget';
    const readOnly = `/home/${TARGET}/readonly`;
    sh('install', ['-d', '-o', 'root', '-g', 'root', '-m', '0755', readOnly]);
    kobox(
      ['set-sync-destination', USER, '127.0.0.1', '22', TARGET, readOnly],
      'nas-password-42\n',
    );
    kobox(['check-sync-destination', USER]);
    drainQueue();

    const row = dbRow('SELECT last_check_ok, last_check_detail FROM sync_destinations WHERE username = ?', USER);
    expect(row?.last_check_ok).toBe(0);
    expect(row?.last_check_detail).toBe('the account can sign in but cannot write in that folder');
  }, 60_000);

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

    finishDownload('Some.Release.2026.mkv', 'c'.repeat(40));

    const row = dbRow('SELECT state, last_error FROM sync_transfers WHERE username = ?', USER);
    expect(row?.state, String(row?.last_error)).toBe('sent');
    // and it is really there, with its bytes, under a folder named after the
    // category — the layout members' machines already assume
    const landed = `${inbox}/films/Some.Release.2026.mkv`;
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, 'utf8')).toHaveLength(4096);
  }, 120_000);

  // Seen on 2026-11-05: a member who never ran the check had every transfer
  // refused for five days, the machine having no recorded identity. A second
  // sshd of this test's own, on a port of its own, stands for a member's
  // machine that is reinstalled half way.
  it('should_record_a_machine_on_first_contact_by_a_transfer_and_accept_a_new_identity_only_on_a_test', () => {
    const TARGET = 'e2esynctarget';
    const inbox = `/home/${TARGET}/incoming`;
    const PORT = '2222';
    const entry = `[127.0.0.1]:${PORT}`;
    const knownHosts = `/var/lib/kobox/sync/${USER}.known_hosts`;
    const keys = mkdtempSync(join(tmpdir(), 'kobox-sshd-e2e-'));
    const pidFile = join(keys, 'sshd.pid');
    const identityOf = (key: string): string =>
      /SHA256:\S+/.exec(sh('ssh-keygen', ['-lf', `${key}.pub`]))?.[0] ?? '';
    const startSshd = (key: string): void => {
      sh('/usr/sbin/sshd', [
        '-p', PORT, '-h', key, '-o', 'ListenAddress=127.0.0.1', '-o', `PidFile=${pidFile}`,
      ]);
    };
    const stopSshd = (): void => {
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, 'utf8').trim();
        sh('kill', [pid]);
        sh('sh', ['-c', `while kill -0 ${pid} 2>/dev/null; do sleep 0.1; done`]);
        rmSync(pidFile, { force: true });
      }
    };
    const transferOf = (name: string): Record<string, unknown> | undefined =>
      dbRow('SELECT state, last_error FROM sync_transfers WHERE username = ? AND source LIKE ?', USER, `%/${name}`);
    const recordedIdentity = (): unknown =>
      dbRow('SELECT known_host_fingerprint FROM sync_destinations WHERE username = ?', USER)
        ?.known_host_fingerprint;
    for (const key of ['before', 'after']) {
      sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(keys, key)]);
    }
    try {
      // saved while the machine is off: the check that follows the save meets
      // nothing, so nothing is recorded of the machine
      kobox(['set-sync-destination', USER, '127.0.0.1', PORT, TARGET, inbox], 'nas-password-42\n');
      drainQueue();
      expect(dbRow('SELECT last_check_ok FROM sync_destinations WHERE username = ?', USER)?.last_check_ok).toBe(0);
      expect(recordedIdentity()).toBeNull();

      // first contact is a transfer: it goes through and records the machine
      startSshd(join(keys, 'before'));
      finishDownload('First.Contact.mkv', 'd'.repeat(40));
      expect(transferOf('First.Contact.mkv')?.state, String(transferOf('First.Contact.mkv')?.last_error)).toBe('sent');
      expect(existsSync(`${inbox}/films/First.Contact.mkv`)).toBe(true);
      expect(sh('ssh-keygen', ['-F', entry, '-f', knownHosts])).toContain('found');
      expect(recordedIdentity()).toBe(identityOf(join(keys, 'before')));

      // reinstalled: a transfer never accepts the new identity, and says what to do
      stopSshd();
      startSshd(join(keys, 'after'));
      finishDownload('After.Reinstall.mkv', 'e'.repeat(40));
      expect(transferOf('After.Reinstall.mkv')).toEqual({
        state: 'failed',
        last_error:
          'the machine presented another identity than the one recorded for it, so nothing was sent: if you reinstalled it, test the connection again to accept its new identity, otherwise stop and check why',
      });
      expect(existsSync(`${inbox}/films/After.Reinstall.mkv`)).toBe(false);
      expect(recordedIdentity()).toBe(identityOf(join(keys, 'before')));

      // the member tests the connection: that accepts the new identity
      kobox(['check-sync-destination', USER, '--trust', 'accept-presented']);
      drainQueue();
      const checked = dbRow('SELECT last_check_ok, last_check_detail FROM sync_destinations WHERE username = ?', USER);
      expect(checked?.last_check_ok, String(checked?.last_check_detail)).toBe(1);
      expect(recordedIdentity()).toBe(identityOf(join(keys, 'after')));
      finishDownload('Once.Accepted.mkv', 'f'.repeat(40));
      expect(transferOf('Once.Accepted.mkv')?.state).toBe('sent');
    } finally {
      stopSshd();
      try {
        sh('ssh-keygen', ['-R', entry, '-f', knownHosts], { stdio: 'ignore' });
      } catch {
        /* never recorded */
      }
      rmSync(keys, { recursive: true, force: true });
      // the suite's other tests send to the box's own sshd
      kobox(['set-sync-destination', USER, '127.0.0.1', '22', TARGET, inbox], 'nas-password-42\n');
      drainQueue();
    }
  }, 180_000);

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

  it('should_admit_a_private_torrent_added_without_a_file_the_way_a_client_adds_one', () => {
    // Sonarr and Radarr drive rTorrent over httprpc: there is no .torrent file
    // on disk, so privacy used to be unknowable and the torrent was skipped.
    // On MySB the same gap made a private torrent look public and get blocked,
    // which is why an operator had to disable the rule for themselves.
    // stored uppercase: InfoHash normalises, and querying the lower-case form
    // finds nothing while the code is working perfectly
    const hash = 'D'.repeat(40);

    sh('runuser', [
      '-u',
      USER,
      '--',
      'sh',
      join(HOME, '.rTorrent_inserted_new.sh'),
      hash,
      'Client.Added.Release',
      `${HOME}/rtorrent/complete`,
      '', // no loaded file: this is the whole point
      `${HOME}/rtorrent/torrents`,
      '',
      '1', // d.is_private, straight from rTorrent
    ]);
    drainQueue();

    const row = dbRow(
      'SELECT state FROM torrents WHERE username = ? AND info_hash = ?',
      USER,
      hash,
    );
    // admitted on rTorrent's own answer, with no bypass flag set on the account
    expect(row?.state).toBe('loaded');
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

  it('should_start_a_torrent_dropped_into_a_watch_folder', async () => {
    // How members actually add downloads: a .torrent dropped into Watch from
    // the Nextcloud app. rTorrent loads it stopped (load.normal) so the hook can
    // vet the tracker first; on MySB the hook then started it, and a torrent
    // left stopped here is a download that silently never happens.
    const fixture = aTorrentFile({ name: 'dropped-linux.iso', isPrivate: true });
    const dropped = join(HOME, 'rtorrent/watch/films/dropped-linux.iso.torrent');
    // a real box's worker has made the spool long before any drop
    drainQueue({ KOBOX_SPOOL: DEFAULT_SPOOL_DIR });
    writeFileSync(dropped, fixture.data);
    sh('chown', [`${USER}:kobox-users`, dropped]);

    // rtorrent's watch schedule loads the file stopped and runs the
    // inserted_new shim itself, every 5 s; it spools as on a real box
    await eventually(async () => {
      drainQueue({ KOBOX_SPOOL: DEFAULT_SPOOL_DIR });
      expect(await rtorrentState(fixture.infoHash)).toBe(1);
    }, 30_000);
    // watch is a drop box: once added, the file is filed under torrents/
    expect(existsSync(join(HOME, 'rtorrent/torrents/films/dropped-linux.iso.torrent'))).toBe(true);
    expect(existsSync(dropped)).toBe(false);
  }, 60_000);

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

  it('should_let_rtorrent_restart_after_its_blocklist_has_been_rendered', async () => {
    // the failure this guards against: the member's blocklist directory was
    // created root:root, so rtorrent crash-looped on "could not open ip filter
    // file" the first time it restarted, on a box where everything else looked
    // healthy and the file itself was readable
    kobox(['render-blocklist-filters', USER]);
    drainQueue(); // the CLI enqueues; the worker is what writes the files
    sh('systemctl', ['restart', `rtorrent-${USER}`]);
    await waitForScgi(SCGI_PORT, 30_000);

    expect(sh('systemctl', ['is-active', `rtorrent-${USER}`]).trim()).toBe('active');
  }, 60_000);

  it('should_deprovision_everything_on_delete', () => {
    kobox(['delete-user', USER]);
    drainQueue();

    expect(existsSync(`/etc/systemd/system/rtorrent-${USER}.service`)).toBe(false);
    expect(unitProperty('ActiveState')).not.toBe('active');
    expect(dbRow('SELECT id FROM torrent_instances WHERE username = ?', USER)).toBeUndefined();
    expect(dbRow('SELECT id FROM torrents WHERE username = ?', USER)).toBeUndefined();
  });

});
