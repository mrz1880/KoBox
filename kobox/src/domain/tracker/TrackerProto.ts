import { DomainError } from '../shared/DomainError.js';

export class InvalidTrackerProtoError extends DomainError {
  constructor(raw: string) {
    super(`invalid tracker protocol ${JSON.stringify(raw)}: must be http, https or udp`);
  }
}

export type TrackerProtoValue = 'http' | 'https' | 'udp';

const PROTOCOLS: readonly TrackerProtoValue[] = ['http', 'https', 'udp'];
// Legacy default ports (funcs_GetTrackersCert: http & udp fall back to 80).
const DEFAULT_PORTS: Record<TrackerProtoValue, number> = { http: 80, https: 443, udp: 80 };

export class TrackerProto {
  private constructor(readonly value: TrackerProtoValue) {}

  static parse(raw: string): TrackerProto {
    const proto = PROTOCOLS.find((candidate) => candidate === raw);
    if (!proto) {
      throw new InvalidTrackerProtoError(raw);
    }
    return new TrackerProto(proto);
  }

  get defaultPort(): number {
    return DEFAULT_PORTS[this.value];
  }

  // Only TCP-based protocols can answer an openssl s_client probe.
  get isCheckable(): boolean {
    return this.value !== 'udp';
  }

  equals(other: TrackerProto): boolean {
    return this.value === other.value;
  }
}
