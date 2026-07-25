import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Username } from '../../../../src/domain/user/Username.js';
import { EasyRsaPkiAdapter } from '../../../../src/infrastructure/system/EasyRsaPkiAdapter.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }

  argvs(): readonly (readonly string[])[] {
    return this.calls.map((c) => [c.command, ...c.args]);
  }
}

const alice = Username.parse('alice');

let pkiDir: string;
let runner: RecordingRunner;
let adapter: EasyRsaPkiAdapter;

beforeEach(() => {
  pkiDir = join(mkdtempSync(join(tmpdir(), 'kobox-pki-')), 'pki');
  runner = new RecordingRunner();
  adapter = new EasyRsaPkiAdapter(runner, pkiDir);
});

afterEach(() => {
  rmSync(join(pkiDir, '..'), { recursive: true, force: true });
});

function seedPki(...files: readonly string[]): void {
  for (const file of files) {
    const path = join(pkiDir, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'FIXTURE');
  }
}

describe('EasyRsaPkiAdapter', () => {
  it('should_bootstrap_an_ec_pki_from_nothing_in_batch_mode', async () => {
    await adapter.ensurePki();

    expect(runner.argvs()).toEqual([
      ['/usr/share/easy-rsa/easyrsa', 'init-pki'],
      ['/usr/share/easy-rsa/easyrsa', 'build-ca', 'nopass'],
      ['/usr/share/easy-rsa/easyrsa', 'build-server-full', 'server', 'nopass'],
    ]);
    for (const call of runner.calls) {
      expect(call.env).toMatchObject({
        EASYRSA_BATCH: '1',
        EASYRSA_PKI: pkiDir,
        EASYRSA_ALGO: 'ec',
        EASYRSA_CURVE: 'secp384r1',
      });
    }
  });

  it('should_never_regenerate_existing_material_on_re_run', async () => {
    // re-running install must not invalidate distributed certificates
    seedPki('ca.crt', 'issued/server.crt');

    await adapter.ensurePki();

    expect(runner.argvs()).toEqual([]);
  });

  it('should_rebuild_only_the_missing_server_cert', async () => {
    seedPki('ca.crt');

    await adapter.ensurePki();

    expect(runner.argvs()).toEqual([
      ['/usr/share/easy-rsa/easyrsa', 'build-server-full', 'server', 'nopass'],
    ]);
  });

  it('should_issue_a_client_cert_once_and_only_once', async () => {
    seedPki('ca.crt', 'issued/server.crt');

    await adapter.ensureClientMaterial(alice);
    expect(runner.argvs()).toEqual([
      ['/usr/share/easy-rsa/easyrsa', 'build-client-full', 'alice', 'nopass'],
    ]);

    seedPki('issued/alice.crt', 'private/alice.key');
    await adapter.ensureClientMaterial(alice);
    expect(runner.argvs()).toHaveLength(1);
  });

  it('should_remove_client_material_and_rendered_profiles', async () => {
    seedPki('issued/alice.crt', 'private/alice.key', 'reqs/alice.req');
    const profilesDir = join(pkiDir, '..', 'vpn-profiles');
    mkdirSync(join(profilesDir, 'alice'), { recursive: true });
    // the .ovpn embeds the private key: it must not outlive the user
    writeFileSync(join(profilesDir, 'alice/kobox-tun.ovpn'), 'KEY-MATERIAL');
    const withProfiles = new EasyRsaPkiAdapter(runner, pkiDir, profilesDir);

    await withProfiles.removeClientMaterial(alice);

    expect(existsSync(join(pkiDir, 'issued/alice.crt'))).toBe(false);
    expect(existsSync(join(pkiDir, 'private/alice.key'))).toBe(false);
    expect(existsSync(join(pkiDir, 'reqs/alice.req'))).toBe(false);
    expect(existsSync(join(profilesDir, 'alice'))).toBe(false);
  });

  it('should_read_client_material_like_the_fs_adapter', async () => {
    seedPki('ca.crt', 'issued/alice.crt', 'private/alice.key');

    const material = await adapter.clientMaterial(alice);

    expect(material).toEqual({ caCrt: 'FIXTURE', userCrt: 'FIXTURE', userKey: 'FIXTURE' });
    expect(adapter.serverPaths().caCrt).toBe(join(pkiDir, 'ca.crt'));
  });
});
