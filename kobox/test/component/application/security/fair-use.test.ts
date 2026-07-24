import { beforeEach, describe, expect, it } from 'vitest';
import { EvaluateFairUse } from '../../../../src/application/security/EvaluateFairUse.js';
import { Bandwidth } from '../../../../src/domain/security/Bandwidth.js';
import { FairUsePolicy } from '../../../../src/domain/security/FairUsePolicy.js';
import type { SecurityEvent } from '../../../../src/domain/security/events.js';
import type {
  HealthCheckResult,
  HealthProbePort,
} from '../../../../src/domain/user/ports.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryFairUseRepository } from '../../../../src/infrastructure/persistence/InMemoryFairUseRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeShaping } from '../../../../src/infrastructure/system/fakes/FakeShaping.js';
import { FakeSshAuthLog } from '../../../../src/infrastructure/system/fakes/FakeSshAuthLog.js';
import { FakeUsageMeter } from '../../../../src/infrastructure/system/fakes/FakeUsageMeter.js';
import { FakeUserIdentity } from '../../../../src/infrastructure/system/fakes/FakeUserIdentity.js';
import { aUser } from '../../../builders/UserBuilder.js';

class RecordingSecurityNotifications {
  readonly published: SecurityEvent[] = [];

  notify(event: SecurityEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}

class StubHealthProbe implements HealthProbePort {
  healthy = true;

  checkProcess(name: string): Promise<HealthCheckResult> {
    return Promise.resolve({ name, state: this.healthy ? 'healthy' : 'unhealthy' });
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    return Promise.resolve({
      name: `${host}:${String(port)}`,
      state: this.healthy ? 'healthy' : 'unhealthy',
    });
  }
}

const policy = FairUsePolicy.of({
  sustainedEgress: Bandwidth.mbit(50),
  maxAuthPerHour: 30,
  throttleTo: Bandwidth.mbit(5),
});

const alice = Username.parse('alice');

let users: InMemoryUserRepository;
let fairUse: InMemoryFairUseRepository;
let meter: FakeUsageMeter;
let authLog: FakeSshAuthLog;
let identity: FakeUserIdentity;
let shaping: FakeShaping;
let health: StubHealthProbe;
let notifications: RecordingSecurityNotifications;
let useCase: EvaluateFairUse;

beforeEach(async () => {
  users = new InMemoryUserRepository();
  fairUse = new InMemoryFairUseRepository();
  meter = new FakeUsageMeter();
  authLog = new FakeSshAuthLog();
  identity = new FakeUserIdentity();
  shaping = new FakeShaping();
  health = new StubHealthProbe();
  notifications = new RecordingSecurityNotifications();
  useCase = new EvaluateFairUse({
    users,
    fairUse,
    meter,
    authLog,
    identity,
    shaping,
    health,
    notifications,
    policy,
  });
  await users.save(aUser().build());
  identity.setUid('alice', 1001);
});

describe('EvaluateFairUse — the user-h scenario end-to-end', () => {
  it('should_take_a_baseline_on_the_first_run_without_judging_egress', async () => {
    meter.setCounter('alice', 10_000_000_000, 0);

    const report = await useCase.execute({ now: '2026-07-24 10:00:00' });

    expect(report.evaluated).toBe(1);
    expect(notifications.published).toEqual([]);
    expect((await fairUse.lastSample(alice))?.egressBytes).toBe(10_000_000_000);
  });

  it('should_walk_the_full_ladder_alert_throttle_hold_recover_on_an_auth_flood', async () => {
    authLog.setCount('alice', 82); // the user-h vector

    // run 1: alert
    await useCase.execute({ now: '2026-07-24 10:00:00' });
    expect((await fairUse.getState(alice)).level).toBe('alerted');
    expect(notifications.published.at(-1)?.type).toBe('AbnormalAuthRate');
    expect(shaping.throttled.size).toBe(0); // never act on the first strike

    // run 2: still flooding -> auto-throttle at the budget rate
    await useCase.execute({ now: '2026-07-24 10:05:00' });
    expect((await fairUse.getState(alice)).level).toBe('throttled');
    expect(shaping.throttled.get(1001)?.rate.bps).toBe(5_000_000);
    expect(notifications.published.at(-1)?.type).toBe('UserThrottled');

    // run 3: unchanged -> hold silently
    const before = notifications.published.length;
    await useCase.execute({ now: '2026-07-24 10:10:00' });
    expect(notifications.published).toHaveLength(before);

    // run 4: calm again -> unthrottle + recovery notice
    authLog.setCount('alice', 2);
    await useCase.execute({ now: '2026-07-24 10:15:00' });
    expect((await fairUse.getState(alice)).level).toBe('none');
    expect(shaping.throttled.size).toBe(0);
    expect(notifications.published.at(-1)?.type).toBe('FairUseRecovered');

    // every transition is on the audit trail
    expect((await fairUse.listEvents(alice)).map((e) => e.eventType)).toEqual([
      'AbnormalAuthRate',
      'UserThrottled',
      'FairUseRecovered',
    ]);
  });

  it('should_breach_on_sustained_egress_computed_from_counter_deltas', async () => {
    meter.setCounter('alice', 1_000_000_000, 0);
    await useCase.execute({ now: '2026-07-24 10:00:00' }); // baseline

    // +600 MB in 60 s = 80 Mbit/s > 50 Mbit/s
    meter.setCounter('alice', 1_600_000_000, 0);
    await useCase.execute({ now: '2026-07-24 10:01:00' });

    expect((await fairUse.getState(alice)).level).toBe('alerted');
    const breach = notifications.published.at(-1);
    expect(breach?.type).toBe('FairUseBreached');
    if (breach?.type === 'FairUseBreached') {
      expect(breach.observedBps).toBe(80_000_000);
    }
  });

  it('should_treat_a_counter_reset_as_a_new_baseline_never_a_breach', async () => {
    meter.setCounter('alice', 5_000_000_000, 0);
    await useCase.execute({ now: '2026-07-24 10:00:00' });

    // firewall re-apply zeroed the counters
    meter.setCounter('alice', 1_000, 0);
    await useCase.execute({ now: '2026-07-24 10:01:00' });

    expect(notifications.published).toEqual([]);
    expect((await fairUse.lastSample(alice))?.egressBytes).toBe(1_000);
  });

  it('should_skip_suspended_users_and_users_without_an_account', async () => {
    await users.save(aUser().withUsername('bob').withScgiPort(51102).withRtorrentPort(45001).suspended());
    authLog.setCount('bob', 500);

    const report = await useCase.execute({ now: '2026-07-24 10:00:00' });

    expect(report.evaluated).toBe(1); // alice only
    expect(notifications.published).toEqual([]);
  });

  it('should_report_an_unhealthy_service_once_not_every_run', async () => {
    health.healthy = false;

    await useCase.execute({ now: '2026-07-24 10:00:00' });
    await useCase.execute({ now: '2026-07-24 10:05:00' });

    const unhealthy = notifications.published.filter((e) => e.type === 'ServiceUnhealthy');
    expect(unhealthy).toHaveLength(1);
  });

  it('should_honor_per_user_overrides', async () => {
    await fairUse.saveOverrides(alice, { maxAuthPerHour: 120 });
    authLog.setCount('alice', 82);

    await useCase.execute({ now: '2026-07-24 10:00:00' });

    expect((await fairUse.getState(alice)).level).toBe('none');
    expect(notifications.published).toEqual([]);
  });
});
