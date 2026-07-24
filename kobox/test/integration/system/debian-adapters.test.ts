import { execFileSync } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Label } from '../../../src/domain/torrent/Label.js';
import { WatchDir } from '../../../src/domain/torrent/WatchDir.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../src/domain/user/Password.js';
import { Username } from '../../../src/domain/user/Username.js';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { OpensslPasswordHasher } from '../../../src/infrastructure/system/OpensslPasswordHasher.js';
import { ProcessSocketHealthProbe } from '../../../src/infrastructure/system/ProcessSocketHealthProbe.js';
import { RtorrentConfigAdapter } from '../../../src/infrastructure/system/RtorrentConfigAdapter.js';
import { SftpAdapter } from '../../../src/infrastructure/system/SftpAdapter.js';
import { SystemAccountAdapter } from '../../../src/infrastructure/system/SystemAccountAdapter.js';
import { WatchDirAdapter } from '../../../src/infrastructure/system/WatchDirAdapter.js';

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const runner = new ExecFileRunner();

function cleanupUser(name: string): void {
  try {
    execFileSync('userdel', ['-r', name], { stdio: 'ignore' });
  } catch {
    // absent user is fine
  }
}

describe.skipIf(!onDebianAsRoot)('SystemAccountAdapter on real Debian', () => {
  it('should_create_lock_unlock_and_delete_a_real_account', async () => {
    const adapter = new SystemAccountAdapter(runner);
    const username = Username.parse('kbxituser1');
    cleanupUser('kbxituser1');

    await adapter.createAccount(username);
    expect(await adapter.accountExists(username)).toBe(true);
    expect(await adapter.isLocked(username)).toBe(true); // fresh account: '!' in shadow

    await adapter.setPassword(
      username,
      HashedPassword.parse('$6$testsalt$0123456789abcdefghijklmnopqrstuv'),
    );
    expect(await adapter.isLocked(username)).toBe(false);

    await adapter.lockAccount(username);
    expect(await adapter.isLocked(username)).toBe(true);

    await adapter.unlockAccount(username);
    expect(await adapter.isLocked(username)).toBe(false);

    await adapter.deleteAccount(username);
    expect(await adapter.accountExists(username)).toBe(false);
  });

  it('should_hash_a_password_with_real_openssl_and_land_it_in_shadow', async () => {
    const hasher = new OpensslPasswordHasher(runner);
    const adapter = new SystemAccountAdapter(runner);
    const username = Username.parse('kbxituser2');
    cleanupUser('kbxituser2');
    await adapter.createAccount(username);

    const hash = await hasher.hash(Password.parse('s3cretpw!'));
    await adapter.setPassword(username, hash);

    const shadow = execFileSync('getent', ['shadow', 'kbxituser2'], { encoding: 'utf8' });
    expect(shadow).toContain(hash.value);
    await adapter.deleteAccount(username);
  });
});

describe.skipIf(!onDebianAsRoot)('SftpAdapter on real Debian', () => {
  it('should_toggle_chroot_group_membership_idempotently', async () => {
    const accounts = new SystemAccountAdapter(runner);
    const sftp = new SftpAdapter(runner);
    const username = Username.parse('kbxituser3');
    cleanupUser('kbxituser3');
    await accounts.createAccount(username);

    await sftp.enableChrootAccess(username);
    expect(await sftp.isChrootAccessEnabled(username)).toBe(true);

    await sftp.disableChrootAccess(username);
    await sftp.disableChrootAccess(username); // second removal must not throw
    expect(await sftp.isChrootAccessEnabled(username)).toBe(false);

    await accounts.deleteAccount(username);
  });
});

describe.skipIf(!onDebianAsRoot)('torrent adapters on real Debian', () => {
  it('should_apply_rendered_files_idempotently_with_real_ownership', async () => {
    const accounts = new SystemAccountAdapter(runner);
    const config = new RtorrentConfigAdapter(runner);
    const watchDirs = new WatchDirAdapter(runner);
    const username = Username.parse('kbxituser4');
    cleanupUser('kbxituser4');
    await accounts.createAccount(username);

    await watchDirs.ensureLayout(username, [
      WatchDir.root(),
      WatchDir.labeled(Label.parse('films')),
    ]);
    const watchStat = statSync('/home/kbxituser4/rtorrent/watch/films');
    expect(watchStat.isDirectory()).toBe(true);
    expect(watchStat.mode & 0o777).toBe(0o775);

    const rc = {
      path: '/home/kbxituser4/.rtorrent.rc',
      content: 'managed-v1\n',
      mode: '0640',
      owner: 'root',
      group: 'kbxituser4',
    };
    expect(await config.apply([rc])).toEqual([rc.path]);
    expect(await config.apply([rc])).toEqual([]); // idempotent re-apply
    const rcStat = statSync(rc.path);
    expect(rcStat.mode & 0o777).toBe(0o640);
    expect(rcStat.uid).toBe(0);

    // a user drop-in next to managed files survives renders untouched
    const dropIn = '/home/kbxituser4/rtorrent/config.d/99-user.rc';
    writeFileSync(dropIn, 'user tweak\n');
    await config.apply([{ ...rc, content: 'managed-v2\n' }]);
    expect(execFileSync('cat', [dropIn], { encoding: 'utf8' })).toBe('user tweak\n');

    await accounts.deleteAccount(username);
  });
});

describe.skipIf(!onDebianAsRoot)('health probe on real system', () => {
  it('should_see_pid_1_and_reject_a_dead_port', async () => {
    const probe = new ProcessSocketHealthProbe(runner);

    expect((await probe.checkProcess('systemd')).state).toBe('healthy');
    expect((await probe.checkSocket('127.0.0.1', 1)).state).toBe('unhealthy');
  });
});
