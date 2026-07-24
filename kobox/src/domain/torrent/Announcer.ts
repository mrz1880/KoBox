import { DomainError } from '../shared/DomainError.js';

export class InvalidAnnouncerError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid announcer ${JSON.stringify(raw)}: ${reason}`);
  }
}

export type AnnouncerProto = 'http' | 'https' | 'udp';

const PROTOCOLS: readonly AnnouncerProto[] = ['http', 'https', 'udp'];
// The host later reaches openssl/DNS tooling as an execFile argv value
// (Phase 2): keep it shell-safe by construction, like Username.
const HOST_PATTERN = /^[a-z0-9.-]+$/i;

export class Announcer {
  private constructor(
    readonly url: string,
    readonly proto: AnnouncerProto,
    readonly host: string,
  ) {}

  static parse(raw: string): Announcer {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new InvalidAnnouncerError(raw, 'not a URL');
    }
    const proto = PROTOCOLS.find((candidate) => parsed.protocol === `${candidate}:`);
    if (!proto) {
      throw new InvalidAnnouncerError(raw, 'protocol must be http, https or udp');
    }
    const host = parsed.hostname;
    if (!HOST_PATTERN.test(host)) {
      throw new InvalidAnnouncerError(raw, 'host contains unsafe characters');
    }
    return new Announcer(raw, proto, host);
  }
}
