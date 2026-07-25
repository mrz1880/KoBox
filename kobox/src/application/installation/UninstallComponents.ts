import type { ComponentSpec } from '../../domain/installation/catalog.js';
import { planUninstall } from '../../domain/installation/InstallPlan.js';
import type { ComponentRegistry } from '../../domain/installation/ports.js';
import type { ComponentInstaller } from './installers.js';

export interface UninstallReport {
  readonly uninstalled: readonly string[];
}

interface Deps {
  readonly registry: ComponentRegistry;
  readonly installers: ReadonlyMap<string, ComponentInstaller>;
  readonly catalog: readonly ComponentSpec[];
  readonly now: () => string;
  readonly onProgress?: (line: string) => void;
}

// The anti-CleanAll teardown: reverse dependency order over installed
// components only; every uninstall() leaves user data, packages and stock
// configs alone — KoBox stops managing, nothing breaks.
export class UninstallComponents {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<UninstallReport> {
    const { deps } = this;
    const plan = planUninstall(deps.catalog, await deps.registry.states());
    const uninstalled: string[] = [];
    for (const spec of plan) {
      const name = spec.name.value;
      const installer = deps.installers.get(name);
      if (!installer) {
        continue; // a registry row without an installer cannot be torn down
      }
      this.deps.onProgress?.(`uninstalling ${name}…`);
      await installer.uninstall();
      await deps.registry.reset(spec.name, deps.now());
      uninstalled.push(name);
    }
    return { uninstalled };
  }
}
