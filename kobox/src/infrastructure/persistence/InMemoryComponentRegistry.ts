import type { ComponentName } from '../../domain/installation/ComponentName.js';
import { InstallState } from '../../domain/installation/InstallState.js';
import type { Version } from '../../domain/installation/Version.js';
import type {
  ComponentRecord,
  ComponentRegistry,
} from '../../domain/installation/ports.js';

export class InMemoryComponentRegistry implements ComponentRegistry {
  private readonly records = new Map<string, ComponentRecord>();

  states(): Promise<ReadonlyMap<string, InstallState>> {
    return Promise.resolve(
      new Map([...this.records.entries()].map(([name, record]) => [name, record.state])),
    );
  }

  get(name: ComponentName): Promise<ComponentRecord | undefined> {
    return Promise.resolve(this.records.get(name.value));
  }

  markInstalled(name: ComponentName, version: Version | undefined, now: string): Promise<void> {
    this.records.set(name.value, {
      name,
      state: InstallState.parse('installed'),
      ...(version !== undefined && { version }),
      installedAt: now,
    });
    return Promise.resolve();
  }

  markFailed(name: ComponentName, reason: string, now: string): Promise<void> {
    void now;
    this.records.set(name.value, { name, state: InstallState.parse('failed'), reason });
    return Promise.resolve();
  }

  markSkipped(name: ComponentName, reason: string, now: string): Promise<void> {
    void now;
    this.records.set(name.value, { name, state: InstallState.parse('skipped'), reason });
    return Promise.resolve();
  }

  reset(name: ComponentName, now: string): Promise<void> {
    void now;
    this.records.set(name.value, { name, state: InstallState.parse('to_install') });
    return Promise.resolve();
  }
}
