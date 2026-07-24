import { DomainError } from '../shared/DomainError.js';

// to_install: never attempted (or reset by uninstall); failed: attempted and
// broken — BOTH are pending so a failed component re-runs without redoing the
// installed ones (anti-#122). skipped: deliberately not installable here
// (e.g. pgl on Debian 12) — excluded from the plan but honestly recorded.
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
    return this.value === 'to_install' || this.value === 'failed';
  }

  equals(other: InstallState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
