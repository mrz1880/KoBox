import type { AccessFacts, SignalRow } from '../../../../src/interfaces/http/views/userPages.js';

export const G = 1024 ** 3;

export function signalRow(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    username: 'alice',
    suspended: false,
    healthy: true,
    level: 'none',
    egressBytes: 100 * G,
    quotaGib: 412,
    ...overrides,
  };
}

export function accessFacts(overrides: Partial<AccessFacts> = {}): AccessFacts {
  return {
    username: 'alice',
    rtorrentPort: 45001,
    hasAppToken: false,
    sshPort: 22,
    addresses: [],
    hostnames: [],
    hasTwoStep: false,
    ...overrides,
  };
}
