import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { VpnPkiPort, VpnPkiProvisionPort } from '../../domain/security/ports.js';
import type { VpnClientMaterial, VpnServerPaths } from '../../domain/security/vpn.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';
import { DEFAULT_PKI_DIR, FsVpnPkiAdapter } from './FsVpnPkiAdapter.js';

const EASYRSA_BIN = '/usr/share/easy-rsa/easyrsa';
const EASYRSA_TIMEOUT_MS = 120_000;

// EC keys: fast issuance, no multi-minute gen-dh, servers run `dh none`.
// Usernames are shell-safe by the Username VO; still, everything is argv-only.
export class EasyRsaPkiAdapter implements VpnPkiPort, VpnPkiProvisionPort {
  private readonly reader: FsVpnPkiAdapter;

  constructor(
    private readonly runner: CommandRunner,
    private readonly baseDir: string = DEFAULT_PKI_DIR,
  ) {
    this.reader = new FsVpnPkiAdapter(baseDir);
  }

  serverPaths(): VpnServerPaths {
    return this.reader.serverPaths();
  }

  clientMaterial(username: Username): Promise<VpnClientMaterial | undefined> {
    return this.reader.clientMaterial(username);
  }

  async ensurePki(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await this.easyrsa(['init-pki']);
    }
    if (!existsSync(join(this.baseDir, 'ca.crt'))) {
      // REQ_CN only here: build-*-full derive the CN from their name argument
      // and refuse an external one
      await this.easyrsa(['build-ca', 'nopass'], { EASYRSA_REQ_CN: 'kobox-ca' });
    }
    if (!existsSync(join(this.baseDir, 'issued/server.crt'))) {
      await this.easyrsa(['build-server-full', 'server', 'nopass']);
    }
  }

  async ensureClientMaterial(username: Username): Promise<void> {
    if (existsSync(join(this.baseDir, `issued/${username.value}.crt`))) {
      return;
    }
    await this.easyrsa(['build-client-full', username.value, 'nopass']);
  }

  // Removal (not revocation — CRLs are Phase 5): profiles stop rendering the
  // moment the material is gone, which is the delete-user parity we need.
  async removeClientMaterial(username: Username): Promise<void> {
    for (const file of [
      `issued/${username.value}.crt`,
      `private/${username.value}.key`,
      `reqs/${username.value}.req`,
    ]) {
      await rm(join(this.baseDir, file), { force: true });
    }
  }

  private async easyrsa(
    args: readonly string[],
    extraEnv: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    await runOrThrow(this.runner, {
      command: EASYRSA_BIN,
      args: [...args],
      timeoutMs: EASYRSA_TIMEOUT_MS,
      env: {
        EASYRSA_BATCH: '1',
        EASYRSA_PKI: this.baseDir,
        EASYRSA_ALGO: 'ec',
        EASYRSA_CURVE: 'secp384r1',
        ...extraEnv,
      },
    });
  }
}
