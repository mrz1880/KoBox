import { DomainError } from '../shared/DomainError.js';
import type { ComponentSpec } from './catalog.js';
import type { InstallState } from './InstallState.js';

export class InstallPlanError extends DomainError {
  static of(message: string): InstallPlanError {
    return new InstallPlanError(message);
  }
}

// Stable topological order: walk the catalog in declared order, emitting each
// component after its dependencies (depth-first). Deterministic by
// construction — same catalog, same order, every run.
function topologicalOrder(catalog: readonly ComponentSpec[]): readonly ComponentSpec[] {
  const byName = new Map(catalog.map((spec) => [spec.name.value, spec]));
  const ordered: ComponentSpec[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (spec: ComponentSpec): void => {
    if (done.has(spec.name.value)) {
      return;
    }
    if (visiting.has(spec.name.value)) {
      throw InstallPlanError.of(`dependency cycle through ${spec.name.value}`);
    }
    visiting.add(spec.name.value);
    for (const dep of spec.dependsOn) {
      const depSpec = byName.get(dep.value);
      if (!depSpec) {
        throw InstallPlanError.of(`${spec.name.value} depends on unknown component ${dep.value}`);
      }
      visit(depSpec);
    }
    visiting.delete(spec.name.value);
    done.add(spec.name.value);
    ordered.push(spec);
  };

  for (const spec of catalog) {
    visit(spec);
  }
  return ordered;
}

// The resumable plan: every non-installed component in dependency order —
// failed re-runs (anti-#122), skipped re-evaluates (recoverable by re-run).
export function planInstallation(
  catalog: readonly ComponentSpec[],
  states: ReadonlyMap<string, InstallState>,
): readonly ComponentSpec[] {
  return topologicalOrder(catalog).filter(
    (spec) => states.get(spec.name.value)?.isPending() ?? true,
  );
}

// Teardown mirror: installed components only, reverse dependency order.
export function planUninstall(
  catalog: readonly ComponentSpec[],
  states: ReadonlyMap<string, InstallState>,
): readonly ComponentSpec[] {
  return topologicalOrder(catalog)
    .filter((spec) => states.get(spec.name.value)?.value === 'installed')
    .reverse();
}
