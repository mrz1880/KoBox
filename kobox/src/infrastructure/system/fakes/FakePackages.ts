import type { PackagePort } from '../../../domain/installation/ports.js';

export class FakePackages implements PackagePort {
  readonly installed: string[] = [];
  refreshCount = 0;
  private readonly available = new Set<string>();
  private readonly versions = new Map<string, string>();
  private readonly unavailable = new Set<string>();

  markAvailable(pkg: string, version = '1.0-1'): void {
    this.available.add(pkg);
    this.versions.set(pkg, version);
  }

  markUnavailable(pkg: string): void {
    this.unavailable.add(pkg);
  }

  refresh(): Promise<void> {
    this.refreshCount += 1;
    return Promise.resolve();
  }

  ensureInstalled(packages: readonly string[]): Promise<void> {
    for (const pkg of packages) {
      if (!this.installed.includes(pkg)) {
        this.installed.push(pkg);
      }
    }
    return Promise.resolve();
  }

  // everything is available by default except what the test marks otherwise
  isAvailable(pkg: string): Promise<boolean> {
    return Promise.resolve(!this.unavailable.has(pkg));
  }

  isInstalled(pkg: string): Promise<boolean> {
    return Promise.resolve(this.installed.includes(pkg));
  }

  installedVersion(pkg: string): Promise<string | undefined> {
    if (!this.installed.includes(pkg)) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.versions.get(pkg) ?? '1.0-1');
  }
}
