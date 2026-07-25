import { FairUseEvaluator } from '../../domain/security/FairUseEvaluator.js';
import type { FairUsePolicy, ResourceBudget } from '../../domain/security/FairUsePolicy.js';
import { ConnectionRate, EgressRate } from '../../domain/security/Rates.js';
import type {
  FairUseRepository,
  SecurityNotificationPort,
  ShapingPort,
  UsageCounter,
  UsageMeterPort,
  SshAuthLogPort,
  UserIdentityPort,
} from '../../domain/security/ports.js';
import type { SecurityEvent } from '../../domain/security/events.js';
import type { HealthProbePort, UserRepository } from '../../domain/user/ports.js';
import type { SeedboxUser } from '../../domain/user/SeedboxUser.js';
import type { Username } from '../../domain/user/Username.js';

const AUTH_WINDOW_MINUTES = 60;

export interface FairUseReport {
  readonly evaluated: number;
  readonly breaches: number;
  readonly throttled: number;
}

interface Deps {
  readonly users: UserRepository;
  readonly fairUse: FairUseRepository;
  readonly meter: UsageMeterPort;
  readonly authLog: SshAuthLogPort;
  readonly identity: UserIdentityPort;
  readonly shaping: ShapingPort;
  readonly health: HealthProbePort;
  readonly notifications: SecurityNotificationPort;
  readonly policy: FairUsePolicy;
}

// Layer 3 of the user-h answer: per-user observation vs budget, the pure
// evaluator decides, this use case carries out — throttle/unthrottle through
// the shaper, every event notified AND appended to the audit trail.
export class EvaluateFairUse {
  constructor(private readonly deps: Deps) {}

  async execute({ now }: { now: string }): Promise<FairUseReport> {
    const { users, meter, fairUse } = this.deps;
    const counters = new Map<string, UsageCounter>(
      (await meter.readCounters()).map((counter) => [counter.username, counter]),
    );

    let evaluated = 0;
    let breaches = 0;
    let throttled = 0;
    for (const user of await users.listAll()) {
      if (user.status.isSuspended()) {
        // suspended = already handled by a human; but a user throttled THEN
        // suspended must not keep an inert tc class (Phase 3 review debt)
        await this.releaseSuspendedThrottle(user.username, now);
        continue;
      }
      const uid = await this.deps.identity.uidOf(user.username);
      if (uid === undefined) {
        continue;
      }
      evaluated += 1;
      const { decision, budget } = await this.evaluateOne(
        user,
        counters.get(user.username.value),
        now,
      );
      breaches += decision.events.some(
        (event) => event.type === 'FairUseBreached' || event.type === 'AbnormalAuthRate',
      )
        ? 1
        : 0;
      throttled += decision.actions.includes('throttle') ? 1 : 0;

      for (const action of decision.actions) {
        if (action === 'throttle') {
          await this.deps.shaping.throttle(user.username, uid, budget.throttleTo);
        } else {
          await this.deps.shaping.unthrottle(user.username, uid);
        }
      }
      for (const event of decision.events) {
        await fairUse.appendEvent(user.username, event.type, JSON.stringify(event), now);
        await this.deps.notifications.notify(event);
      }
    }
    return { evaluated, breaches, throttled };
  }

  private async releaseSuspendedThrottle(username: Username, now: string): Promise<void> {
    const { fairUse, identity, shaping } = this.deps;
    const state = await fairUse.getState(username);
    if (state.level !== 'throttled') {
      return;
    }
    const uid = await identity.uidOf(username);
    if (uid !== undefined) {
      await shaping.unthrottle(username, uid);
    }
    await fairUse.saveState(username, { ...state, level: 'none' }, now);
    await fairUse.appendEvent(
      username,
      'SuspendedUserUnthrottled',
      JSON.stringify({ username: username.value }),
      now,
    );
  }

  private async evaluateOne(
    user: SeedboxUser,
    counter: UsageCounter | undefined,
    now: string,
  ): Promise<{
    decision: {
      events: readonly SecurityEvent[];
      actions: readonly ('throttle' | 'unthrottle')[];
    };
    budget: ResourceBudget;
  }> {
    const { fairUse, authLog, health } = this.deps;
    const username = user.username;

    const sample = await fairUse.lastSample(username);
    let egress: EgressRate | undefined;
    if (counter !== undefined && sample !== undefined) {
      const deltaBytes = counter.egressBytes - sample.egressBytes;
      const deltaSeconds = (Date.parse(now) - Date.parse(sample.sampledAt)) / 1000;
      // a shrinking counter means the firewall re-applied and zeroed the
      // chains: new baseline, never a negative rate
      if (deltaBytes >= 0 && deltaSeconds > 0) {
        egress = EgressRate.fromDelta(deltaBytes, deltaSeconds);
      }
    }
    if (counter !== undefined) {
      await fairUse.putSample(username, {
        egressBytes: counter.egressBytes,
        ingressBytes: counter.ingressBytes,
        sampledAt: now,
      });
    }

    const authCount = await authLog.countAcceptedPublickey(username, AUTH_WINDOW_MINUTES);
    const socket = await health.checkSocket('127.0.0.1', user.scgiPort.value);
    const state = await fairUse.getState(username);
    const budget = this.deps.policy.budgetFor(await fairUse.overridesFor(username));

    const decision = FairUseEvaluator.evaluate({
      username,
      ...(egress !== undefined && { egress }),
      authRate: ConnectionRate.perHour(authCount, AUTH_WINDOW_MINUTES),
      budget,
      level: state.level,
      healthState: state.healthState,
      serviceHealthy: socket.state === 'healthy',
    });

    if (decision.nextLevel !== state.level || decision.nextHealthState !== state.healthState) {
      await fairUse.saveState(
        username,
        { level: decision.nextLevel, healthState: decision.nextHealthState },
        now,
      );
    }
    return { decision, budget };
  }
}
