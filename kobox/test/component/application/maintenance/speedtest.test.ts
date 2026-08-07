import { beforeEach, describe, expect, it } from 'vitest';
import { RunSpeedtest } from '../../../../src/application/maintenance/RunSpeedtest.js';
import type { SpeedtestPort } from '../../../../src/application/maintenance/SpeedtestPort.js';
import { Speedtest } from '../../../../src/domain/maintenance/speedtest.js';
import { Bandwidth } from '../../../../src/domain/security/Bandwidth.js';
import { InMemorySpeedtestRepository } from '../../../../src/infrastructure/persistence/InMemorySpeedtestRepository.js';

const NOW = '2026-07-31 10:00:00';

function aResult(measuredAt: string, downMbit: number): Speedtest {
  return Speedtest.record({
    download: Bandwidth.mbit(downMbit),
    upload: Bandwidth.mbit(20),
    latencyMs: 12,
    server: 'test-server',
    measuredAt,
  });
}

class FakeSpeedtest implements SpeedtestPort {
  calls = 0;
  failWith: Error | undefined;
  measure(now: string): Promise<Speedtest> {
    this.calls += 1;
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(aResult(now, 900));
  }
}

let repo: InMemorySpeedtestRepository;
let speedtest: FakeSpeedtest;

beforeEach(() => {
  repo = new InMemorySpeedtestRepository();
  speedtest = new FakeSpeedtest();
});

describe('RunSpeedtest', () => {
  it('should_measure_the_link_and_keep_the_result', async () => {
    await new RunSpeedtest({ speedtest, repo, clock: () => NOW }).execute();

    const kept = await repo.listRecent(10);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.download.bps).toBe(900_000_000);
    expect(kept[0]?.measuredAt).toBe(NOW);
  });

  it('should_let_a_failed_measurement_fail_the_job_rather_than_store_a_lie', async () => {
    speedtest.failWith = new Error('speedtest unavailable: binary missing');

    await expect(
      new RunSpeedtest({ speedtest, repo, clock: () => NOW }).execute(),
    ).rejects.toThrow(/unavailable/);

    // nothing recorded: an absent measurement must not look like a slow link
    expect(await repo.listRecent(10)).toHaveLength(0);
  });

  it('should_keep_a_series_newest_first_so_a_drift_is_readable', async () => {
    await repo.save(aResult('2026-07-01 10:00:00', 900));
    await repo.save(aResult('2026-07-15 10:00:00', 600));
    await repo.save(aResult('2026-07-31 10:00:00', 300));

    const series = await repo.listRecent(2);

    expect(series).toHaveLength(2);
    expect(series[0]?.measuredAt).toBe('2026-07-31 10:00:00');
    expect(series[1]?.measuredAt).toBe('2026-07-15 10:00:00');
  });
});

describe('Speedtest', () => {
  it('should_refuse_a_negative_latency', () => {
    expect(() =>
      Speedtest.record({
        download: Bandwidth.mbit(100),
        upload: Bandwidth.mbit(10),
        latencyMs: -1,
        server: 'x',
        measuredAt: NOW,
      }),
    ).toThrow();
  });
});
