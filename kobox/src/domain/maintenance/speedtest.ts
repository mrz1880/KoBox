import { Bandwidth } from '../security/Bandwidth.js';
import { DomainError } from '../shared/DomainError.js';

export class InvalidLatencyError extends DomainError {
  constructor(raw: number) {
    super(`invalid latency ${String(raw)}: must be a non-negative millisecond count`);
  }
}

interface SpeedtestProps {
  readonly id?: number;
  readonly download: Bandwidth;
  readonly upload: Bandwidth;
  readonly latencyMs: number;
  // which measurement server answered — a low figure means little without it
  readonly server: string;
  readonly measuredAt: string;
}

// One measurement of what the link can actually carry, kept so a series can be
// read: a single figure says little, a drift over weeks says the connection is
// degrading. Rates use the same Bandwidth unit as the fair-use ceilings, so the
// two are directly comparable.
export class Speedtest {
  readonly id?: number;
  readonly download: Bandwidth;
  readonly upload: Bandwidth;
  readonly latencyMs: number;
  readonly server: string;
  readonly measuredAt: string;

  private constructor(props: SpeedtestProps) {
    if (props.id !== undefined) {
      this.id = props.id;
    }
    this.download = props.download;
    this.upload = props.upload;
    this.latencyMs = props.latencyMs;
    this.server = props.server;
    this.measuredAt = props.measuredAt;
  }

  static record(props: SpeedtestProps): Speedtest {
    if (!Number.isFinite(props.latencyMs) || props.latencyMs < 0) {
      throw new InvalidLatencyError(props.latencyMs);
    }
    return new Speedtest(props);
  }

  identifiedBy(id: number): Speedtest {
    return new Speedtest({ ...this.props(), id });
  }

  private props(): SpeedtestProps {
    return {
      ...(this.id !== undefined && { id: this.id }),
      download: this.download,
      upload: this.upload,
      latencyMs: this.latencyMs,
      server: this.server,
      measuredAt: this.measuredAt,
    };
  }
}
