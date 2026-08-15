import { describe, expect, it } from 'vitest';
import { COMPONENT_CATALOG, type ComponentSpec } from '../../../../src/domain/installation/catalog.js';
import { ComponentName } from '../../../../src/domain/installation/ComponentName.js';
import {
  InstallPlanError,
  planInstallation,
  planUninstall,
} from '../../../../src/domain/installation/InstallPlan.js';
import { InstallState } from '../../../../src/domain/installation/InstallState.js';

const freshStates = new Map<string, InstallState>();

function states(entries: Record<string, string>): ReadonlyMap<string, InstallState> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, InstallState.parse(v)]));
}

function names(specs: readonly ComponentSpec[]): readonly string[] {
  return specs.map((spec) => spec.name.value);
}

describe('planInstallation', () => {
  it('should_order_the_full_catalog_with_kobox_core_first_and_dependencies_satisfied', () => {
    const plan = planInstallation(COMPONENT_CATALOG);

    const order = names(plan);
    expect(order[0]).toBe('kobox-core');
    expect(order).toHaveLength(COMPONENT_CATALOG.length);
    // every dependency appears before its dependent
    for (const spec of plan) {
      for (const dep of spec.dependsOn) {
        expect(order.indexOf(dep.value)).toBeLessThan(order.indexOf(spec.name.value));
      }
    }
    // the documented seams
    expect(order.indexOf('dnscrypt')).toBeLessThan(order.indexOf('bind'));
    expect(order.indexOf('nginx')).toBeLessThan(order.indexOf('rutorrent'));
    expect(order.indexOf('rtorrent')).toBeLessThan(order.indexOf('rutorrent'));
    expect(order.indexOf('sshd')).toBeLessThan(order.indexOf('fail2ban'));
  });

  it('should_be_deterministic', () => {
    const first = names(planInstallation(COMPONENT_CATALOG));
    const second = names(planInstallation(COMPONENT_CATALOG));
    expect(second).toEqual(first);
  });

  it('should_plan_every_component_so_a_changed_pin_is_noticed', () => {
    // This used to skip anything already `installed`, which made `kobox install`
    // a no-op for a component whose pin had moved: OPS.md promises "the
    // component re-vendors when the sum differs from the installed marker", and
    // that comparison lives INSIDE the installer, so it was never reached.
    // Re-pinning NanoMon on a real box did nothing at all until the registry row
    // was edited by hand.
    //
    // Converging is now the planner's job and no-oping is the installer's: each
    // one guards its own work behind a marker, an ensureInstalled or a content
    // comparison, so revisiting a converged component costs a check.
    const plan = planInstallation(COMPONENT_CATALOG);

    expect(names(plan)).toEqual(names(planInstallation(COMPONENT_CATALOG)));
  });

  it('should_still_reach_a_failed_component_in_dependency_order', () => {
    // resumability is unchanged: an interrupted run re-runs from the top and
    // arrives at the component that failed, with its dependencies behind it
    const fullOrder = names(planInstallation(COMPONENT_CATALOG));
    const resumed = names(planInstallation(COMPONENT_CATALOG));

    expect(resumed).toEqual(fullOrder);
    for (const spec of COMPONENT_CATALOG) {
      for (const dep of spec.dependsOn) {
        expect(resumed.indexOf(dep.value)).toBeLessThan(resumed.indexOf(spec.name.value));
      }
    }
  });

  it('should_re_evaluate_skipped_components_so_a_fixed_cause_recovers_by_re_run', () => {
    expect(names(planInstallation(COMPONENT_CATALOG))).toContain('dnscrypt');
  });

  it('should_schedule_the_cron_component_after_kobox_core', () => {
    const order = names(planInstallation(COMPONENT_CATALOG));
    expect(order.indexOf('kobox-core')).toBeLessThan(order.indexOf('scheduler'));
    expect(order).not.toContain('pgl');
  });



  it('should_reject_a_dependency_cycle', () => {
    const a = ComponentName.parse('nginx');
    const b = ComponentName.parse('rtorrent');
    const cyclic: readonly ComponentSpec[] = [
      { name: a, dependsOn: [b] },
      { name: b, dependsOn: [a] },
    ];
    expect(() => planInstallation(cyclic)).toThrow(InstallPlanError);
  });

  it('should_reject_a_dependency_missing_from_the_catalog', () => {
    const broken: readonly ComponentSpec[] = [
      { name: ComponentName.parse('rutorrent'), dependsOn: [ComponentName.parse('nginx')] },
    ];
    expect(() => planInstallation(broken)).toThrow(InstallPlanError);
  });
});

describe('planUninstall', () => {
  it('should_reverse_the_install_order_over_installed_components_only', () => {
    const all = Object.fromEntries(
      COMPONENT_CATALOG.map((spec) => [spec.name.value, 'installed']),
    );
    const uninstall = names(
      planUninstall(COMPONENT_CATALOG, states({ ...all, dnscrypt: 'skipped' })),
    );

    const install = names(planInstallation(COMPONENT_CATALOG)).filter(
      (name) => name !== 'dnscrypt',
    );
    expect(uninstall).toEqual([...install].reverse());
  });

  it('should_return_nothing_on_a_fresh_box', () => {
    expect(planUninstall(COMPONENT_CATALOG, freshStates)).toHaveLength(0);
  });
});
