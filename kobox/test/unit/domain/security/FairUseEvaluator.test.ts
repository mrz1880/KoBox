import { describe, expect, it } from 'vitest';
import { Bandwidth } from '../../../../src/domain/security/Bandwidth.js';
import {
  FAIR_USE_ACTIONS,
  FairUseEvaluator,
  type EvaluationInput,
} from '../../../../src/domain/security/FairUseEvaluator.js';
import { FairUsePolicy } from '../../../../src/domain/security/FairUsePolicy.js';
import { ConnectionRate, EgressRate } from '../../../../src/domain/security/Rates.js';
import { Username } from '../../../../src/domain/user/Username.js';

const budget = FairUsePolicy.of({
  sustainedEgress: Bandwidth.mbit(50),
  maxAuthPerHour: 30,
  throttleTo: Bandwidth.mbit(5),
}).budgetFor();

const calmAuth = ConnectionRate.perHour(3, 60);
const floodAuth = ConnectionRate.perHour(82, 60); // the user-h vector
const calmEgress = EgressRate.fromDelta(60_000_000, 60); // 8 Mbit/s
const heavyEgress = EgressRate.fromDelta(600_000_000, 60); // 80 Mbit/s

function evaluate(overrides: Partial<EvaluationInput>): ReturnType<typeof FairUseEvaluator.evaluate> {
  return FairUseEvaluator.evaluate({
    username: Username.parse('alice'),
    egress: calmEgress,
    authRate: calmAuth,
    budget,
    level: 'none',
    healthState: 'healthy',
    serviceHealthy: true,
    ...overrides,
  });
}

describe('FairUseEvaluator — the frozen graduated response', () => {
  it('should_stay_quiet_when_everything_is_within_budget', () => {
    const decision = evaluate({});
    expect(decision).toEqual({
      nextLevel: 'none',
      nextHealthState: 'healthy',
      events: [],
      actions: [],
    });
  });

  it('should_alert_first_on_an_auth_flood_never_act_immediately', () => {
    const decision = evaluate({ authRate: floodAuth });
    expect(decision.nextLevel).toBe('alerted');
    expect(decision.actions).toEqual([]);
    expect(decision.events).toEqual([
      { type: 'AbnormalAuthRate', username: 'alice', perHour: 82, limitPerHour: 30 },
    ]);
  });

  it('should_alert_first_on_an_egress_breach', () => {
    const decision = evaluate({ egress: heavyEgress });
    expect(decision.nextLevel).toBe('alerted');
    expect(decision.events).toEqual([
      {
        type: 'FairUseBreached',
        username: 'alice',
        metric: 'egress',
        observedBps: 80_000_000,
        limitBps: 50_000_000,
      },
    ]);
  });

  it('should_throttle_when_a_breach_persists_past_the_alert', () => {
    const decision = evaluate({ level: 'alerted', authRate: floodAuth });
    expect(decision.nextLevel).toBe('throttled');
    expect(decision.actions).toEqual(['throttle']);
    expect(decision.events).toEqual([
      { type: 'UserThrottled', username: 'alice', rateBps: 5_000_000 },
    ]);
  });

  it('should_hold_the_throttle_silently_but_reassert_it_while_the_breach_continues', () => {
    // re-asserting through the idempotent shaper repairs tc state lost to a
    // reboot while the DB still says throttled — silently: no event spam
    const decision = evaluate({ level: 'throttled', egress: heavyEgress });
    expect(decision.nextLevel).toBe('throttled');
    expect(decision.actions).toEqual(['throttle']);
    expect(decision.events).toEqual([]); // no notification spam
  });

  it('should_recover_and_unthrottle_when_the_breach_stops', () => {
    const decision = evaluate({ level: 'throttled' });
    expect(decision.nextLevel).toBe('none');
    expect(decision.actions).toEqual(['unthrottle']);
    expect(decision.events).toEqual([{ type: 'FairUseRecovered', username: 'alice' }]);
  });

  it('should_recover_from_alerted_without_any_action', () => {
    const decision = evaluate({ level: 'alerted' });
    expect(decision.nextLevel).toBe('none');
    expect(decision.actions).toEqual([]);
    expect(decision.events).toEqual([{ type: 'FairUseRecovered', username: 'alice' }]);
  });

  it('should_pass_no_judgment_without_an_egress_baseline', () => {
    const decision = FairUseEvaluator.evaluate({
      username: Username.parse('alice'),
      authRate: calmAuth,
      budget,
      level: 'none',
      healthState: 'healthy',
      serviceHealthy: true,
    });
    expect(decision.nextLevel).toBe('none');
    expect(decision.events).toEqual([]);
  });

  it('should_emit_service_unhealthy_only_on_the_transition', () => {
    const first = evaluate({ serviceHealthy: false });
    expect(first.nextHealthState).toBe('unhealthy');
    expect(first.events).toEqual([
      { type: 'ServiceUnhealthy', username: 'alice', detail: 'rtorrent socket unreachable' },
    ]);

    const second = evaluate({ serviceHealthy: false, healthState: 'unhealthy' });
    expect(second.events).toEqual([]); // already known — no spam

    const recovered = evaluate({ serviceHealthy: true, healthState: 'unhealthy' });
    expect(recovered.nextHealthState).toBe('healthy');
  });

  it('suspension_is_not_an_expressible_action_it_stays_manual', () => {
    // The locked decision (2026-07-23): the automated ladder ends at
    // throttle; SuspendUser is a human act. The action vocabulary cannot
    // even say "suspend".
    expect(FAIR_USE_ACTIONS).toEqual(['throttle', 'unthrottle']);
  });
});
