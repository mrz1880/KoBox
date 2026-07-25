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
    const plan = planInstallation(COMPONENT_CATALOG, freshStates);

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
    const first = names(planInstallation(COMPONENT_CATALOG, freshStates));
    const second = names(planInstallation(COMPONENT_CATALOG, freshStates));
    expect(second).toEqual(first);
  });

  it('should_resume_from_a_failed_component_without_redoing_installed_ones', () => {
    // anti-#122: everything before bind installed, bind failed mid-run
    const fullOrder = names(planInstallation(COMPONENT_CATALOG, freshStates));
    const bindIndex = fullOrder.indexOf('bind');
    const done = Object.fromEntries(
      fullOrder.slice(0, bindIndex).map((name) => [name, 'installed']),
    );
    const resumed = planInstallation(
      COMPONENT_CATALOG,
      states({ ...done, bind: 'failed' }),
    );

    expect(names(resumed)).toEqual(fullOrder.slice(bindIndex));
  });

  it('should_re_evaluate_skipped_components_so_a_fixed_cause_recovers_by_re_run', () => {
    const plan = planInstallation(COMPONENT_CATALOG, states({ dnscrypt: 'skipped' }));
    expect(names(plan)).toContain('dnscrypt');
  });

  it('should_schedule_the_cron_component_after_kobox_core', () => {
    const order = names(planInstallation(COMPONENT_CATALOG, freshStates));
    expect(order.indexOf('kobox-core')).toBeLessThan(order.indexOf('scheduler'));
    expect(order).not.toContain('pgl');
  });

  it('should_return_an_empty_plan_when_everything_is_installed', () => {
    const all = Object.fromEntries(
      COMPONENT_CATALOG.map((spec) => [spec.name.value, 'installed']),
    );
    expect(planInstallation(COMPONENT_CATALOG, states(all))).toHaveLength(0);
  });

  it('should_reject_a_dependency_cycle', () => {
    const a = ComponentName.parse('nginx');
    const b = ComponentName.parse('rtorrent');
    const cyclic: readonly ComponentSpec[] = [
      { name: a, dependsOn: [b] },
      { name: b, dependsOn: [a] },
    ];
    expect(() => planInstallation(cyclic, freshStates)).toThrow(InstallPlanError);
  });

  it('should_reject_a_dependency_missing_from_the_catalog', () => {
    const broken: readonly ComponentSpec[] = [
      { name: ComponentName.parse('rutorrent'), dependsOn: [ComponentName.parse('nginx')] },
    ];
    expect(() => planInstallation(broken, freshStates)).toThrow(InstallPlanError);
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

    const install = names(planInstallation(COMPONENT_CATALOG, freshStates)).filter(
      (name) => name !== 'dnscrypt',
    );
    expect(uninstall).toEqual([...install].reverse());
  });

  it('should_return_nothing_on_a_fresh_box', () => {
    expect(planUninstall(COMPONENT_CATALOG, freshStates)).toHaveLength(0);
  });
});
