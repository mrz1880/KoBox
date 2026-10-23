import { DomainError } from '../shared/DomainError.js';

// The closed catalog of installable components (the KoBox successor of the
// legacy `services` registry). Closed on purpose: the privileged installer
// only ever executes strategies it knows, never an arbitrary name.
export const COMPONENT_NAMES = [
  'nextcloud',
  'kobox-core',
  'apt-sources',
  'sshd',
  'tweaks',
  'quota',
  'nginx',
  'rtorrent',
  'rutorrent',
  'bind',
  'dnscrypt',
  'fail2ban',
  'openvpn',
  'postfix',
  // operations: scheduled jobs, certificates, blocklist enforcement in the kernel
  'scheduler',
  'letsencrypt',
  'ipset',
  // portal and member access
  'portal',
  'nfs',
  'samba',
  'shellinabox',
  // lightweight host monitoring (vendored NanoMon binary)
  'nanomon',
  // DDL/debrid download engine (aria2 daemon, localhost RPC)
  'aria2',
  'speedtest',
] as const;

export type ComponentNameValue = (typeof COMPONENT_NAMES)[number];

export class InvalidComponentNameError extends DomainError {
  constructor(raw: string) {
    super(`unknown component ${JSON.stringify(raw)}`);
  }
}

export class ComponentName {
  private constructor(readonly value: ComponentNameValue) {}

  static parse(raw: string): ComponentName {
    if (!(COMPONENT_NAMES as readonly string[]).includes(raw)) {
      throw new InvalidComponentNameError(raw);
    }
    return new ComponentName(raw as ComponentNameValue);
  }

  equals(other: ComponentName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
