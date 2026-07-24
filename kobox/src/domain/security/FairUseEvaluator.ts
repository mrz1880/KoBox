import type { Username } from '../user/Username.js';
import type { ResourceBudget } from './FairUsePolicy.js';
import type { ConnectionRate, EgressRate } from './Rates.js';
import type { SecurityEvent } from './events.js';
import type { FairUseLevel, UserHealthState } from './ports.js';

// The automated ladder ends at throttle — suspension stays a human act
// (locked decision 2026-07-23) and is not expressible here.
export const FAIR_USE_ACTIONS = ['throttle', 'unthrottle'] as const;
export type FairUseAction = (typeof FAIR_USE_ACTIONS)[number];

export interface EvaluationInput {
  readonly username: Username;
  // undefined = no baseline yet (first run, or counters reset) — no judgment
  readonly egress?: EgressRate;
  readonly authRate: ConnectionRate;
  readonly budget: ResourceBudget;
  readonly level: FairUseLevel;
  readonly healthState: UserHealthState;
  readonly serviceHealthy: boolean;
}

export interface EvaluationDecision {
  readonly nextLevel: FairUseLevel;
  readonly nextHealthState: UserHealthState;
  readonly events: readonly SecurityEvent[];
  readonly actions: readonly FairUseAction[];
}

// Pure decision table for the frozen graduated response:
//   none --breach--> alerted (notify only)
//   alerted --still breaching--> throttled (auto-throttle, notify)
//   throttled --still breaching--> throttled (hold, silent)
//   any --breach gone--> none (unthrottle if needed, notify recovery)
export const FairUseEvaluator = {
  evaluate(input: EvaluationInput): EvaluationDecision {
    const { username, budget } = input;
    const events: SecurityEvent[] = [];
    const actions: FairUseAction[] = [];

    const egress = input.egress;
    const egressBreach = egress !== undefined && budget.isEgressBreach(egress);
    const authBreach = budget.isAuthBreach(input.authRate);
    const breach = egressBreach || authBreach;

    let nextLevel: FairUseLevel = input.level;
    if (breach && input.level === 'none') {
      nextLevel = 'alerted';
      if (egressBreach) {
        events.push({
          type: 'FairUseBreached',
          username: username.value,
          metric: 'egress',
          observedBps: egress.bitsPerSecond,
          limitBps: budget.sustainedEgress.bps,
        });
      }
      if (authBreach) {
        events.push({
          type: 'AbnormalAuthRate',
          username: username.value,
          perHour: input.authRate.value,
          limitPerHour: budget.maxAuthPerHour,
        });
      }
    } else if (breach && input.level === 'alerted') {
      nextLevel = 'throttled';
      actions.push('throttle');
      events.push({
        type: 'UserThrottled',
        username: username.value,
        rateBps: budget.throttleTo.bps,
      });
    } else if (breach && input.level === 'throttled') {
      // hold silently but RE-ASSERT through the idempotent shaper: tc state
      // lost to a reboot gets repaired while the DB still says throttled
      actions.push('throttle');
    } else if (!breach && input.level !== 'none') {
      nextLevel = 'none';
      if (input.level === 'throttled') {
        actions.push('unthrottle');
      }
      events.push({ type: 'FairUseRecovered', username: username.value });
    }

    const nextHealthState: UserHealthState = input.serviceHealthy ? 'healthy' : 'unhealthy';
    if (!input.serviceHealthy && input.healthState === 'healthy') {
      events.push({
        type: 'ServiceUnhealthy',
        username: username.value,
        detail: 'rtorrent socket unreachable',
      });
    }

    return { nextLevel, nextHealthState, events, actions };
  },
};
