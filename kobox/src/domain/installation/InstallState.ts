import { DomainError } from '../shared/DomainError.js';

// to_install: never attempted (or reset by uninstall); failed: attempted and
// broken; skipped: deliberately not installable here (pgl on Debian 12, no
// ruTorrent pin). Everything but installed stays pending: failures re-run
// without redoing the rest (anti-#122), and skips are re-evaluated every run
// (cheap, idempotent) so a fixed cause recovers by plain re-run — never DB
// surgery.
export const INSTALL_STATES = ['to_install', 'installed', 'failed', 'skipped'] as const;

export type InstallStateValue = (typeof INSTALL_STATES)[number];

export class InvalidInstallStateError extends DomainError {
  constructor(raw: string) {
    super(`unknown install state ${JSON.stringify(raw)}`);
  }
}

export class InstallState {
  private constructor(readonly value: InstallStateValue) {}

  static parse(raw: string): InstallState {
    if (!(INSTALL_STATES as readonly string[]).includes(raw)) {
      throw new InvalidInstallStateError(raw);
    }
    return new InstallState(raw as InstallStateValue);
  }

  isPending(): boolean {
    return this.value !== 'installed';
  }

  equals(other: InstallState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
