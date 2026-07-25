import type { SystemdPort } from '../../../domain/installation/ports.js';

export class FakeSystemd implements SystemdPort {
  readonly log: string[] = [];
  private readonly active = new Set<string>();

  daemonReload(): Promise<void> {
    this.log.push('daemon-reload');
    return Promise.resolve();
  }

  enable(unit: string, opts?: { readonly now?: boolean }): Promise<void> {
    this.log.push(opts?.now === true ? `enable-now ${unit}` : `enable ${unit}`);
    if (opts?.now === true) {
      this.active.add(unit);
    }
    return Promise.resolve();
  }

  disable(unit: string, opts?: { readonly now?: boolean }): Promise<void> {
    this.log.push(opts?.now === true ? `disable-now ${unit}` : `disable ${unit}`);
    if (opts?.now === true) {
      this.active.delete(unit);
    }
    return Promise.resolve();
  }

  start(unit: string): Promise<void> {
    this.log.push(`start ${unit}`);
    this.active.add(unit);
    return Promise.resolve();
  }

  reloadOrRestart(unit: string): Promise<void> {
    this.log.push(`reload-or-restart ${unit}`);
    return Promise.resolve();
  }

  isActive(unit: string): Promise<boolean> {
    return Promise.resolve(this.active.has(unit));
  }
}
