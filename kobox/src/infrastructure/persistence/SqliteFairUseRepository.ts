import { asc, eq } from 'drizzle-orm';
import { Bandwidth } from '../../domain/security/Bandwidth.js';
import type { FairUseOverrides } from '../../domain/security/FairUsePolicy.js';
import type {
  FairUseAuditEntry,
  FairUseRepository,
  FairUseState,
  UsageSample,
} from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { fairUseEvents, fairUsePolicies, fairUseState, usageSamples } from './schema.js';

export class SqliteFairUseRepository implements FairUseRepository {
  constructor(private readonly db: KoboxDatabase) {}

  getState(username: Username): Promise<FairUseState> {
    const row = this.db.orm
      .select()
      .from(fairUseState)
      .where(eq(fairUseState.username, username.value))
      .get();
    return Promise.resolve(
      row ? { level: row.level, healthState: row.healthState } : { level: 'none', healthState: 'healthy' },
    );
  }

  saveState(username: Username, state: FairUseState, now: string): Promise<void> {
    this.db.orm
      .insert(fairUseState)
      .values({
        username: username.value,
        level: state.level,
        healthState: state.healthState,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: fairUseState.username,
        set: { level: state.level, healthState: state.healthState, updatedAt: now },
      })
      .run();
    return Promise.resolve();
  }

  appendEvent(
    username: Username,
    eventType: string,
    detailJson: string,
    now: string,
  ): Promise<void> {
    this.db.orm
      .insert(fairUseEvents)
      .values({ username: username.value, eventType, detailJson, createdAt: now })
      .run();
    return Promise.resolve();
  }

  listEvents(username: Username): Promise<readonly FairUseAuditEntry[]> {
    const rows = this.db.orm
      .select()
      .from(fairUseEvents)
      .where(eq(fairUseEvents.username, username.value))
      .orderBy(asc(fairUseEvents.id))
      .all();
    return Promise.resolve(
      rows.map((row) => ({
        eventType: row.eventType,
        detailJson: row.detailJson,
        createdAt: row.createdAt,
      })),
    );
  }

  overridesFor(username: Username): Promise<FairUseOverrides | undefined> {
    const row = this.db.orm
      .select()
      .from(fairUsePolicies)
      .where(eq(fairUsePolicies.username, username.value))
      .get();
    if (!row) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      ...(row.egressLimitBps !== null && {
        sustainedEgress: Bandwidth.bitsPerSecond(row.egressLimitBps),
      }),
      ...(row.authRatePerHour !== null && { maxAuthPerHour: row.authRatePerHour }),
      ...(row.throttleToBps !== null && { throttleTo: Bandwidth.bitsPerSecond(row.throttleToBps) }),
    });
  }

  saveOverrides(username: Username, overrides: FairUseOverrides): Promise<void> {
    const values = {
      username: username.value,
      egressLimitBps: overrides.sustainedEgress?.bps ?? null,
      authRatePerHour: overrides.maxAuthPerHour ?? null,
      throttleToBps: overrides.throttleTo?.bps ?? null,
    };
    this.db.orm
      .insert(fairUsePolicies)
      .values(values)
      .onConflictDoUpdate({ target: fairUsePolicies.username, set: values })
      .run();
    return Promise.resolve();
  }

  lastSample(username: Username): Promise<UsageSample | undefined> {
    const row = this.db.orm
      .select()
      .from(usageSamples)
      .where(eq(usageSamples.username, username.value))
      .get();
    return Promise.resolve(
      row
        ? { egressBytes: row.egressBytes, ingressBytes: row.ingressBytes, sampledAt: row.sampledAt }
        : undefined,
    );
  }

  putSample(username: Username, sample: UsageSample): Promise<void> {
    const values = { username: username.value, ...sample };
    this.db.orm
      .insert(usageSamples)
      .values(values)
      .onConflictDoUpdate({ target: usageSamples.username, set: values })
      .run();
    return Promise.resolve();
  }
}
