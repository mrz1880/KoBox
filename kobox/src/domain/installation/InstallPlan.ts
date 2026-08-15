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

// The convergence plan: EVERY component, in dependency order.
//
// This used to drop anything already `installed`, which made `kobox install` a
// no-op for a component whose pin had moved — OPS.md promises "the component
// re-vendors when the sum differs from the installed marker", and that
// comparison lives inside the installer, so it was never reached. Re-pinning
// NanoMon on a real box did nothing until the registry row was edited by hand.
//
// Converging is the planner's job; no-oping is the installer's. Each one guards
// its work behind a marker, an ensureInstalled, or a content comparison that
// only reloads a service when the rendered file actually changed, so revisiting
// a converged component costs a check and nothing else. Resumability is
// unaffected: an interrupted run re-runs from the top and reaches the component
// that failed with its dependencies behind it.
export function planInstallation(catalog: readonly ComponentSpec[]): readonly ComponentSpec[] {
  return topologicalOrder(catalog);
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
