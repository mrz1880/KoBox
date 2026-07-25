import { beforeEach, describe, expect, it } from 'vitest';
import type { ComponentInstaller, InstallOutcome } from '../../../../src/application/installation/installers.js';
import {
  ComponentInstallError,
  PreflightFailedError,
  RunInstallation,
} from '../../../../src/application/installation/RunInstallation.js';
import { UninstallComponents } from '../../../../src/application/installation/UninstallComponents.js';
import type { ComponentSpec } from '../../../../src/domain/installation/catalog.js';
import { ComponentName } from '../../../../src/domain/installation/ComponentName.js';
import type { SystemFacts } from '../../../../src/domain/installation/ports.js';
import { InMemoryComponentRegistry } from '../../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';
import { FakePackages } from '../../../../src/infrastructure/system/fakes/FakePackages.js';

const healthyFacts: SystemFacts = {
  osId: 'debian',
  osVersionId: '12',
  arch: 'amd64',
  euid: 0,
  rootFsType: 'ext4',
  hasDefaultRoute: true,
  hasTunDevice: true,
};

class StubInstaller implements ComponentInstaller {
  installCalls = 0;
  uninstallCalls = 0;

  constructor(
    readonly name: ComponentInstaller['name'],
    private readonly outcome: () => InstallOutcome,
  ) {}

  install(): Promise<InstallOutcome> {
    this.installCalls += 1;
    return Promise.resolve(this.outcome());
  }

  uninstall(): Promise<void> {
    this.uninstallCalls += 1;
    return Promise.resolve();
  }
}

function spec(name: string, dependsOn: readonly string[] = []): ComponentSpec {
  return {
    name: ComponentName.parse(name),
    dependsOn: dependsOn.map((dep) => ComponentName.parse(dep)),
  };
}

// a small catalog keeps the orchestration behavior readable
const catalog: readonly ComponentSpec[] = [
  spec('kobox-core'),
  spec('sshd'),
  spec('bind'),
  spec('fail2ban', ['sshd']),
];

interface World {
  readonly registry: InMemoryComponentRegistry;
  readonly packages: FakePackages;
  readonly installers: Map<string, StubInstaller>;
  readonly enqueued: string[];
  drained: number;
  facts: SystemFacts;
}

let world: World;

function stub(name: string, outcome: () => InstallOutcome = () => ({ state: 'installed' })): StubInstaller {
  const installer = new StubInstaller(name as ComponentInstaller['name'], outcome);
  world.installers.set(name, installer);
  return installer;
}

function runner(): RunInstallation {
  return new RunInstallation({
    facts: { gather: () => Promise.resolve(world.facts) },
    registry: world.registry,
    packages: world.packages,
    installers: world.installers,
    catalog,
    enqueueConvergence: (type) => {
      world.enqueued.push(type);
      return Promise.resolve();
    },
    drain: () => {
      world.drained += 1;
      return Promise.resolve(world.enqueued.length);
    },
    now: () => '2026-07-25 08:00:00',
  });
}

beforeEach(() => {
  world = {
    registry: new InMemoryComponentRegistry(),
    packages: new FakePackages(),
    installers: new Map(),
    enqueued: [],
    drained: 0,
    facts: healthyFacts,
  };
  for (const name of ['kobox-core', 'sshd', 'bind', 'fail2ban']) {
    stub(name);
  }
});

describe('RunInstallation', () => {
  it('should_install_everything_in_order_then_converge_via_the_job_queue', async () => {
    const report = await runner().execute({ allowNonExt4: false });

    expect(report.installed).toEqual(['kobox-core', 'sshd', 'bind', 'fail2ban']);
    expect(world.packages.refreshCount).toBe(1);
    expect(world.enqueued).toEqual([
      'apply-firewall',
      'render-fail2ban',
      'render-whitelist',
      'render-openvpn',
    ]);
    expect(world.drained).toBe(1);
    expect((await world.registry.get(ComponentName.parse('sshd')))?.state.value).toBe('installed');
  });

  it('should_refuse_to_mutate_anything_when_preflight_fails', async () => {
    world.facts = { ...healthyFacts, euid: 1000, rootFsType: 'overlay' };

    await expect(runner().execute({ allowNonExt4: false })).rejects.toThrow(PreflightFailedError);

    for (const installer of world.installers.values()) {
      expect(installer.installCalls).toBe(0);
    }
    expect(world.packages.refreshCount).toBe(0);
    expect(world.enqueued).toEqual([]);
    expect((await world.registry.states()).size).toBe(0);
  });

  it('should_stop_at_the_first_failure_record_it_and_resume_from_there', async () => {
    let bindAttempts = 0;
    stub('bind', () => {
      bindAttempts += 1;
      if (bindAttempts === 1) {
        throw new Error('named-checkconf exited 1');
      }
      return { state: 'installed' };
    });

    await expect(runner().execute({ allowNonExt4: false })).rejects.toThrow(ComponentInstallError);

    const failed = await world.registry.get(ComponentName.parse('bind'));
    expect(failed?.state.value).toBe('failed');
    expect(failed?.reason).toContain('named-checkconf');
    // fail2ban never ran: deterministic stop, propagated exit (anti-#122)
    expect(world.installers.get('fail2ban')?.installCalls).toBe(0);
    expect(world.enqueued).toEqual([]);

    const report = await runner().execute({ allowNonExt4: false });

    expect(report.installed).toEqual(['bind', 'fail2ban']);
    expect(report.alreadyInstalled).toEqual(['kobox-core', 'sshd']);
    expect(world.installers.get('kobox-core')?.installCalls).toBe(1); // never redone
  });

  it('should_record_skips_and_keep_them_out_of_later_plans', async () => {
    stub('bind', () => ({ state: 'skipped', reason: 'not packaged here' }));

    const first = await runner().execute({ allowNonExt4: false });
    expect(first.skipped).toEqual(['bind']);

    const second = await runner().execute({ allowNonExt4: false });
    expect(second.alreadyInstalled).toEqual(['kobox-core', 'sshd', 'fail2ban']);
    expect(world.installers.get('bind')?.installCalls).toBe(1);
  });

  it('should_be_idempotent_and_still_reconverge_on_re_run', async () => {
    await runner().execute({ allowNonExt4: false });
    world.enqueued.length = 0;

    const report = await runner().execute({ allowNonExt4: false });

    expect(report.installed).toEqual([]);
    expect(report.alreadyInstalled).toEqual(['kobox-core', 'sshd', 'bind', 'fail2ban']);
    for (const installer of world.installers.values()) {
      expect(installer.installCalls).toBe(1);
    }
    // convergence is cheap and idempotent by Phase 1-3 design: always re-run
    expect(world.enqueued).toEqual([
      'apply-firewall',
      'render-fail2ban',
      'render-whitelist',
      'render-openvpn',
    ]);
  });
});

describe('UninstallComponents', () => {
  it('should_uninstall_in_reverse_order_and_reset_the_registry', async () => {
    await runner().execute({ allowNonExt4: false });

    const uninstall = new UninstallComponents({
      registry: world.registry,
      installers: world.installers,
      catalog,
      now: () => '2026-07-25 09:00:00',
    });
    const report = await uninstall.execute();

    expect(report.uninstalled).toEqual(['fail2ban', 'bind', 'sshd', 'kobox-core']);
    for (const name of ['kobox-core', 'sshd', 'bind', 'fail2ban']) {
      expect(world.installers.get(name)?.uninstallCalls).toBe(1);
      expect((await world.registry.get(ComponentName.parse(name)))?.state.value).toBe(
        'to_install',
      );
    }
  });

  it('should_leave_skipped_components_alone', async () => {
    stub('bind', () => ({ state: 'skipped', reason: 'not packaged here' }));
    await runner().execute({ allowNonExt4: false });

    const uninstall = new UninstallComponents({
      registry: world.registry,
      installers: world.installers,
      catalog,
      now: () => '2026-07-25 09:00:00',
    });
    const report = await uninstall.execute();

    expect(report.uninstalled).not.toContain('bind');
    expect(world.installers.get('bind')?.uninstallCalls).toBe(0);
    expect((await world.registry.get(ComponentName.parse('bind')))?.state.value).toBe('skipped');
  });
});
