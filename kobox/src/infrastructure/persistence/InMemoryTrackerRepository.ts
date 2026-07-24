import type { Tracker } from '../../domain/tracker/Tracker.js';
import type { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import type { TrackerRepository } from '../../domain/tracker/ports.js';

export class InMemoryTrackerRepository implements TrackerRepository {
  private readonly byHost = new Map<string, Tracker>();

  findByHost(host: TrackerHost): Promise<Tracker | undefined> {
    return Promise.resolve(this.byHost.get(host.value));
  }

  listAll(): Promise<readonly Tracker[]> {
    return Promise.resolve([...this.byHost.values()]);
  }

  async listNeedingCertCheck(today: string): Promise<readonly Tracker[]> {
    const all = await this.listAll();
    return all.filter((tracker) => !tracker.isDead && tracker.needsCertCheck(today));
  }

  save(tracker: Tracker): Promise<Tracker> {
    this.byHost.set(tracker.host.value, tracker);
    return Promise.resolve(tracker);
  }
}
