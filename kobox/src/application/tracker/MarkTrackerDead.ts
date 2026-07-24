import type { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import type {
  CertStorePort,
  TrackerNotificationPort,
  TrackerRepository,
} from '../../domain/tracker/ports.js';
import { TrackerNotFoundError } from './errors.js';

export interface MarkTrackerDeadCommand {
  readonly host: TrackerHost;
}

export interface MarkDeadReport {
  readonly whitelistDirty: boolean;
}

interface Deps {
  readonly trackers: TrackerRepository;
  readonly certStore: CertStorePort;
  readonly notifications: TrackerNotificationPort;
}

export class MarkTrackerDead {
  constructor(private readonly deps: Deps) {}

  async execute(command: MarkTrackerDeadCommand): Promise<MarkDeadReport> {
    const { trackers, certStore, notifications } = this.deps;
    const tracker = await trackers.findByHost(command.host);
    if (!tracker) {
      throw new TrackerNotFoundError(command.host.value);
    }
    const { tracker: dead, event } = tracker.markDead();
    if (!event) {
      return { whitelistDirty: false };
    }
    await trackers.save(dead);
    await certStore.remove(command.host);
    await notifications.notify(event);
    return { whitelistDirty: true };
  }
}
