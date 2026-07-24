import type { IpAddress } from '../shared/IpAddress.js';
import type { CertExpiry } from './CertExpiry.js';
import { CheckState } from './CheckState.js';
import type { TrackerHost } from './TrackerHost.js';
import type { TrackerPort } from './TrackerPort.js';
import type { TrackerPrivacy } from './TrackerPrivacy.js';
import { TrackerProto } from './TrackerProto.js';
import type { TrackerDied, TrackerDiscovered } from './events.js';

interface TrackerProps {
  readonly host: TrackerHost;
  readonly proto: TrackerProto;
  readonly port: TrackerPort;
  readonly privacy: TrackerPrivacy;
  readonly isActive: boolean;
  readonly isDead: boolean;
  readonly isSsl: boolean;
  readonly checkState: CheckState;
  readonly ipv4: readonly IpAddress[];
  readonly certExpiry?: CertExpiry;
  readonly lastCheck?: string;
}

export type CheckOutcome =
  | { readonly promoted: true; readonly expiry: CertExpiry; readonly at: string }
  | { readonly promoted: false; readonly at: string };

// One row of the tracker whitelist. Identity is the host (natural key).
// The cert lifecycle mirrors the legacy to_check machine (pending -> checking
// -> none) but as explicit state transitions instead of raw column writes.
export class Tracker {
  readonly host: TrackerHost;
  readonly proto: TrackerProto;
  readonly port: TrackerPort;
  readonly privacy: TrackerPrivacy;
  readonly isActive: boolean;
  readonly isDead: boolean;
  readonly isSsl: boolean;
  readonly checkState: CheckState;
  readonly ipv4: readonly IpAddress[];
  readonly certExpiry?: CertExpiry;
  readonly lastCheck?: string;

  private constructor(props: TrackerProps) {
    this.host = props.host;
    this.proto = props.proto;
    this.port = props.port;
    this.privacy = props.privacy;
    this.isActive = props.isActive;
    this.isDead = props.isDead;
    this.isSsl = props.isSsl;
    this.checkState = props.checkState;
    this.ipv4 = props.ipv4;
    if (props.certExpiry !== undefined) {
      this.certExpiry = props.certExpiry;
    }
    if (props.lastCheck !== undefined) {
      this.lastCheck = props.lastCheck;
    }
  }

  static discover(
    props: Pick<TrackerProps, 'host' | 'proto' | 'port' | 'privacy'>,
  ): { tracker: Tracker; event: TrackerDiscovered } {
    const tracker = new Tracker({
      ...props,
      isActive: true,
      isDead: false,
      isSsl: false,
      checkState: CheckState.parse(props.proto.isCheckable ? 'pending' : 'none'),
      ipv4: [],
    });
    return { tracker, event: { type: 'TrackerDiscovered', host: props.host.value } };
  }

  // Rehydration from persistence — no event, state is whatever was stored.
  static restore(props: TrackerProps): Tracker {
    return new Tracker(props);
  }

  updateAddresses(resolved: readonly IpAddress[]): Tracker {
    const usable = resolved.filter((ip) => ip.isUsable);
    const current = new Set(this.ipv4.map((ip) => ip.value));
    const next = new Set(usable.map((ip) => ip.value));
    const unchanged = current.size === next.size && [...next].every((ip) => current.has(ip));
    if (unchanged) {
      return this;
    }
    return new Tracker({
      ...this.props(),
      ipv4: usable,
      checkState: this.proto.isCheckable ? CheckState.parse('pending') : this.checkState,
    });
  }

  updatePort(port: TrackerPort): Tracker {
    // A promoted tracker's TLS endpoint is pinned; later announces on other
    // ports must not downgrade it (the cert was fetched on this port).
    if (this.isSsl || this.port.equals(port)) {
      return this;
    }
    return new Tracker({ ...this.props(), port });
  }

  beginCheck(): Tracker {
    return new Tracker({ ...this.props(), checkState: CheckState.parse('checking') });
  }

  completeCheck(outcome: CheckOutcome): Tracker {
    // Deliberately rebuilt without certExpiry: a failed check clears it.
    const base: TrackerProps = {
      host: this.host,
      proto: this.proto,
      port: this.port,
      privacy: this.privacy,
      isActive: this.isActive,
      isDead: this.isDead,
      isSsl: false,
      checkState: CheckState.parse('none'),
      ipv4: this.ipv4,
      lastCheck: outcome.at,
    };
    if (!outcome.promoted) {
      return new Tracker(base);
    }
    return new Tracker({
      ...base,
      isSsl: true,
      proto: TrackerProto.parse('https'),
      certExpiry: outcome.expiry,
    });
  }

  // A probe that got no answer on an ALREADY promoted tracker: keep the
  // certificate state (transient network failures must not end monitoring),
  // stamp the attempt, and stay pending so the next sweep retries.
  deferCheck(at: string): Tracker {
    return new Tracker({
      ...this.props(),
      checkState: CheckState.parse('pending'),
      lastCheck: at,
    });
  }

  markDead(): { tracker: Tracker; event?: TrackerDied } {
    if (this.isDead) {
      return { tracker: this };
    }
    return {
      tracker: new Tracker({ ...this.props(), isDead: true, isActive: false }),
      event: { type: 'TrackerDied', host: this.host.value },
    };
  }

  needsCertCheck(today: string): boolean {
    // 'checking' is included on purpose: a worker crash mid-check must
    // self-heal on the next sweep instead of leaking the lock forever
    // (jobs are serialized by the single root worker, so re-selection is safe).
    if (this.checkState.value !== 'none') {
      return true;
    }
    return this.isSsl && (this.certExpiry?.isDueOn(today) ?? false);
  }

  private props(): TrackerProps {
    return {
      host: this.host,
      proto: this.proto,
      port: this.port,
      privacy: this.privacy,
      isActive: this.isActive,
      isDead: this.isDead,
      isSsl: this.isSsl,
      checkState: this.checkState,
      ipv4: this.ipv4,
      ...(this.certExpiry !== undefined && { certExpiry: this.certExpiry }),
      ...(this.lastCheck !== undefined && { lastCheck: this.lastCheck }),
    };
  }
}
