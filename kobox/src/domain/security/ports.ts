import type { RenderedFile } from '../shared/files.js';
import type { IpAddress } from '../shared/IpAddress.js';
import type { Cidr } from './Cidr.js';
import type { Username } from '../user/Username.js';
import type { Bandwidth } from './Bandwidth.js';
import type { DynDnsHost } from './DynDnsHost.js';
import type { FairUseOverrides } from './FairUsePolicy.js';
import type { SecurityEvent } from './events.js';
import type { VpnClientMaterial, VpnServerPaths } from './vpn.js';

// 'unchanged': on-disk rules already match — no restore ran (idempotence).
// 'rolled-back': the new ruleset broke the SSH lifeline probe and the previous
// ruleset was restored — the caller must treat this as a loud failure.
export type FirewallApplyOutcome = 'applied' | 'unchanged' | 'rolled-back';

export interface FirewallApplyPort {
  apply(rules: RenderedFile): Promise<FirewallApplyOutcome>;
  // the ONE nat mutation KoBox makes: the with-gateway VPN masquerade,
  // check-then-add (the nat table is shared with Docker, never restored)
  ensureMasquerade(subnet: Cidr): Promise<void>;
}

export interface ShapingPort {
  throttle(username: Username, uid: number, rate: Bandwidth): Promise<void>;
  unthrottle(username: Username, uid: number): Promise<void>;
  isThrottled(uid: number): Promise<boolean>;
}

// Cumulative byte counters since the last firewall apply (iptables zeroes
// them on restore) — consumers must treat a shrinking value as a new baseline.
export interface UsageCounter {
  readonly username: string;
  readonly egressBytes: number;
  readonly ingressBytes: number;
}

export interface UsageMeterPort {
  readCounters(): Promise<readonly UsageCounter[]>;
}

// Where fail2ban is blind: counts ACCEPTED publickey logins from the journal.
export interface SshAuthLogPort {
  countAcceptedPublickey(username: Username, windowMinutes: number): Promise<number>;
}

export interface UserIdentityPort {
  uidOf(username: Username): Promise<number | undefined>;
}

// undefined = NXDOMAIN / no A record. Resolution failures are soft: a
// flapping dyndns must never evict a user's last known address.
export interface DynDnsResolverPort {
  resolve(host: DynDnsHost): Promise<IpAddress | undefined>;
}

// Real service management (replaces the Phase 2 best-effort reloads): a failed
// reload fails the job. Absent units (dev containers without bind9) are the
// one tolerated case, detected explicitly — never a blanket catch.
export interface NetworkServicePort {
  reloadFail2ban(): Promise<void>;
  reloadDns(): Promise<void>;
  reloadNginx(): Promise<void>;
}

export interface DynDnsBinding {
  readonly username: Username;
  readonly host: DynDnsHost;
  readonly resolvedIp?: IpAddress;
}

export interface DynDnsBindingRepository {
  listHostnames(): Promise<readonly DynDnsBinding[]>;
  addHostname(username: Username, host: DynDnsHost): Promise<void>;
  removeHostname(username: Username, host: DynDnsHost): Promise<void>;
  updateResolvedIp(username: Username, host: DynDnsHost, ip: IpAddress): Promise<void>;
}

export type FairUseLevel = 'none' | 'alerted' | 'throttled';
export type UserHealthState = 'healthy' | 'unhealthy';

export interface FairUseState {
  readonly level: FairUseLevel;
  readonly healthState: UserHealthState;
}

export interface FairUseAuditEntry {
  readonly eventType: string;
  readonly detailJson: string;
  readonly createdAt: string;
}

export interface UsageSample {
  readonly egressBytes: number;
  readonly ingressBytes: number;
  readonly sampledAt: string;
}

export interface FairUseRepository {
  getState(username: Username): Promise<FairUseState>;
  saveState(username: Username, state: FairUseState, now: string): Promise<void>;
  appendEvent(
    username: Username,
    eventType: string,
    detailJson: string,
    now: string,
  ): Promise<void>;
  listEvents(username: Username): Promise<readonly FairUseAuditEntry[]>;
  overridesFor(username: Username): Promise<FairUseOverrides | undefined>;
  saveOverrides(username: Username, overrides: FairUseOverrides): Promise<void>;
  lastSample(username: Username): Promise<UsageSample | undefined>;
  putSample(username: Username, sample: UsageSample): Promise<void>;
}

export interface SecurityNotificationPort {
  notify(event: SecurityEvent): Promise<void>;
}

export interface VpnPkiPort {
  serverPaths(): VpnServerPaths;
  clientMaterial(username: Username): Promise<VpnClientMaterial | undefined>;
}

// The mutating side (Phase 4 easy-rsa bootstrap), segregated from the read
// side so render-only consumers keep the narrow port. ensure* never
// regenerates existing material: re-runs must not invalidate distributed
// certificates.
export interface VpnPkiProvisionPort {
  ensurePki(): Promise<void>;
  ensureClientMaterial(username: Username): Promise<void>;
  removeClientMaterial(username: Username): Promise<void>;
}
