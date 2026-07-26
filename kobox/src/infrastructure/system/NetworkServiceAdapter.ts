import type { NetworkServicePort } from '../../domain/security/ports.js';
import { VPN_VARIANTS } from '../../domain/security/vpn.js';
import type { NetworkServiceReloadPort } from '../../domain/tracker/ports.js';
import type { Logger } from '../logging/logger.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const RELOAD_TIMEOUT_MS = 15_000;

export interface NetworkServiceOptions {
  // strict = post-install contract (KOBOX_STRICT_SERVICES=1): an absent unit
  // is breakage, not tolerance. tolerateAbsent lists the components honestly
  // skipped by kobox install (dnscrypt-proxy on Debian 12).
  readonly strict: boolean;
  readonly tolerateAbsent: readonly string[];
}

const DEFAULT_OPTIONS: NetworkServiceOptions = { strict: false, tolerateAbsent: [] };

// Real service management (replaces the Phase 2 best-effort adapter): a
// failed reload now FAILS the calling job. The single tolerated case is an
// absent unit (dev containers without bind9), detected explicitly via
// systemctl list-unit-files and logged — never a blanket catch.
export class NetworkServiceAdapter implements NetworkServicePort, NetworkServiceReloadPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly logger: Logger,
    private readonly options: NetworkServiceOptions = DEFAULT_OPTIONS,
  ) {}

  async reloadFail2ban(): Promise<void> {
    if (await this.unitExists('fail2ban')) {
      await this.run('systemctl', ['reload-or-restart', 'fail2ban']);
    }
  }

  async reloadDns(): Promise<void> {
    if (await this.unitExists('named')) {
      await this.run('rndc', ['reload']);
    }
    if (await this.unitExists('dnscrypt-proxy')) {
      await this.run('systemctl', ['try-restart', 'dnscrypt-proxy']);
    }
  }

  async reloadNginx(): Promise<void> {
    if (await this.unitExists('nginx')) {
      await this.run('systemctl', ['reload', 'nginx']);
    }
  }

  async reloadNfsExports(): Promise<void> {
    if (await this.unitExists('nfs-server')) {
      await this.run('exportfs', ['-ra']);
    }
  }

  // The three servers are templated units (openvpn-server@kobox-<variant>);
  // list-unit-files reports the template, and we reload-or-restart each instance
  // so a fresh CRL directive (or republished crl.pem) takes effect.
  async reloadOpenVpn(): Promise<void> {
    if (await this.unitExists('openvpn-server@')) {
      for (const variant of VPN_VARIANTS) {
        await this.run('systemctl', ['reload-or-restart', `openvpn-server@kobox-${variant}`]);
      }
    }
  }

  private async run(command: string, args: readonly string[]): Promise<void> {
    await runOrThrow(this.runner, { command, args: [...args], timeoutMs: RELOAD_TIMEOUT_MS });
  }

  private async unitExists(unit: string): Promise<boolean> {
    const result = await this.runner.run({
      command: 'systemctl',
      args: ['list-unit-files', `${unit}.service`, '--no-legend'],
      timeoutMs: 5_000,
    });
    // absence answers with an empty listing and a SILENT stderr; anything on
    // stderr means systemctl itself failed (dbus down) — that must escalate,
    // absence is the one tolerated case
    if (result.stderr.trim().length > 0) {
      throw new Error(`systemctl list-unit-files ${unit}: ${result.stderr.trim()}`);
    }
    const exists = result.exitCode === 0 && result.stdout.trim().length > 0;
    if (!exists) {
      if (this.options.strict && !this.options.tolerateAbsent.includes(unit)) {
        throw new Error(
          `strict services mode: unit ${unit} is not installed on a box kobox install provisioned`,
        );
      }
      this.logger.warn({ unit }, 'unit not installed — reload skipped');
    }
    return exists;
  }
}
