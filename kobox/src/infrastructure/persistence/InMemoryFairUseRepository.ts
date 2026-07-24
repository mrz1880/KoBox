import type { FairUseOverrides } from '../../domain/security/FairUsePolicy.js';
import type {
  FairUseAuditEntry,
  FairUseRepository,
  FairUseState,
  UsageSample,
} from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryFairUseRepository implements FairUseRepository {
  private readonly states = new Map<string, FairUseState>();
  private readonly events: (FairUseAuditEntry & { username: string })[] = [];
  private readonly overrides = new Map<string, FairUseOverrides>();
  private readonly samples = new Map<string, UsageSample>();

  getState(username: Username): Promise<FairUseState> {
    return Promise.resolve(
      this.states.get(username.value) ?? { level: 'none', healthState: 'healthy' },
    );
  }

  saveState(username: Username, state: FairUseState, _now: string): Promise<void> {
    this.states.set(username.value, state);
    return Promise.resolve();
  }

  appendEvent(
    username: Username,
    eventType: string,
    detailJson: string,
    now: string,
  ): Promise<void> {
    this.events.push({ username: username.value, eventType, detailJson, createdAt: now });
    return Promise.resolve();
  }

  listEvents(username: Username): Promise<readonly FairUseAuditEntry[]> {
    return Promise.resolve(this.events.filter((event) => event.username === username.value));
  }

  overridesFor(username: Username): Promise<FairUseOverrides | undefined> {
    return Promise.resolve(this.overrides.get(username.value));
  }

  saveOverrides(username: Username, overrides: FairUseOverrides): Promise<void> {
    this.overrides.set(username.value, overrides);
    return Promise.resolve();
  }

  lastSample(username: Username): Promise<UsageSample | undefined> {
    return Promise.resolve(this.samples.get(username.value));
  }

  putSample(username: Username, sample: UsageSample): Promise<void> {
    this.samples.set(username.value, sample);
    return Promise.resolve();
  }
}
