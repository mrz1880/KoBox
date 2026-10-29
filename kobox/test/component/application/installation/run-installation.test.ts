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
import { FakeInstallHost } from '../../../../src/infrastructure/system/fakes/FakeInstallHost.js';
import { FakeSystemd } from '../../../../src/infrastructure/system/fakes/FakeSystemd.js';
import { TearDownRetiredServices } from '../../../../src/application/installation/TearDownRetiredServices.js';
import type { RetiredService } from '../../../../src/domain/installation/retired.js';

const healthyFacts: SystemFacts = {
  osId: 'debian',
  osVersionId: '13',
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
// a service an earlier release installed and this one no longer ships
const retired: RetiredService = {
  unit: 'kobox-engine',
  unitFile: '/etc/systemd/system/kobox-engine.service',
  files: ['/etc/kobox/engine.conf'],
  dirs: ['/var/lib/kobox-engine'],
};

// what an installation run is given to take away
function tearDownRetired(): TearDownRetiredServices {
  return new TearDownRetiredServices({ host: world.host, systemd: world.systemd, retired: [retired] });
}

const catalog: readonly ComponentSpec[] = [
  spec('kobox-core'),
  spec('sshd'),
  spec('bind'),
  spec('fail2ban', ['sshd']),
];

interface World {
  readonly registry: InMemoryComponentRegistry;
  readonly packages: FakePackages;
  readonly host: FakeInstallHost;
  readonly systemd: FakeSystemd;
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
    tearDownRetired: tearDownRetired(),
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
    host: new FakeInstallHost(),
    systemd: new FakeSystemd(),
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
      // a member's exports follow their VPN address: an upgrade re-renders them
      'render-nfs-exports',
      // and each member's ruTorrent wiring, profile folder included
      'render-rutorrent-users',
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
    expect(world.systemd.log).toEqual([]);
  });

  it('should_stop_a_retired_service_before_installing_anything', async () => {
    // the upgrade path: a box re-runs `kobox install` once the new release is in
    await world.host.apply([
      { path: retired.unitFile, content: '[Unit]\n', mode: '0644', owner: 'root', group: 'root' },
    ]);
    let unitThereWhenCoreInstalled: boolean | undefined;
    stub('kobox-core', () => {
      unitThereWhenCoreInstalled = world.host.contentAt(retired.unitFile) !== undefined;
      return { state: 'installed' };
    });

    await runner().execute({ allowNonExt4: false });

    expect(unitThereWhenCoreInstalled).toBe(false);
    expect(world.systemd.log).toEqual(['disable-now kobox-engine', 'daemon-reload']);
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
    // kobox-core is walked again and converges silently: it is not reported as
    // installed by this pass, because this pass did not change it
    expect(world.installers.get('kobox-core')?.installCalls).toBe(2);
  });

  it('should_not_report_an_installed_component_as_skipped_when_its_pin_is_absent', async () => {
    // A component skips for lack of configuration, not for lack of an artifact.
    // Since the plan revisits everything, an install run that does not carry a
    // pin would otherwise flip a working component from installed to skipped and
    // make the registry lie about the box: the Health screen said "no ruTorrent
    // release pinned" while ruTorrent was installed and serving.
    let pinned = true;
    stub('bind', () =>
      pinned ? { state: 'installed' } : { state: 'skipped', reason: 'nothing pinned' },
    );
    await runner().execute({ allowNonExt4: false });

    pinned = false;
    const report = await runner().execute({ allowNonExt4: false });

    expect(report.skipped).not.toContain('bind');
    expect((await world.registry.get(ComponentName.parse('bind')))?.state.value).toBe('installed');
  });

  it('should_record_skips_and_re_evaluate_them_on_every_run', async () => {
    let bindAvailable = false;
    stub('bind', () =>
      bindAvailable ? { state: 'installed' } : { state: 'skipped', reason: 'not packaged here' },
    );

    const first = await runner().execute({ allowNonExt4: false });
    expect(first.skipped).toEqual(['bind']);

    // the cause persists: re-skip, cheap and idempotent
    const second = await runner().execute({ allowNonExt4: false });
    expect(second.skipped).toEqual(['bind']);
    expect(second.alreadyInstalled).toEqual(['kobox-core', 'sshd', 'fail2ban']);

    // the cause is fixed (pin set, package packaged): a plain re-run recovers
    bindAvailable = true;
    const third = await runner().execute({ allowNonExt4: false });
    expect(third.installed).toEqual(['bind']);
  });

  it('should_be_idempotent_and_still_reconverge_on_re_run', async () => {
    await runner().execute({ allowNonExt4: false });
    world.enqueued.length = 0;

    const report = await runner().execute({ allowNonExt4: false });

    expect(report.installed).toEqual([]);
    expect(report.alreadyInstalled).toEqual(['kobox-core', 'sshd', 'bind', 'fail2ban']);
    // every installer is revisited — that is what makes a changed pin land —
    // and each one finds its own work already done
    for (const installer of world.installers.values()) {
      expect(installer.installCalls).toBe(2);
    }
    // fully converged: still no second apt-get update
    expect(world.packages.refreshCount).toBe(1);
    // convergence is cheap and idempotent by Phase 1-3 design: always re-run
    expect(world.enqueued).toEqual([
      'apply-firewall',
      'render-fail2ban',
      'render-whitelist',
      'render-openvpn',
      // a member's exports follow their VPN address: an upgrade re-renders them
      'render-nfs-exports',
      // and each member's ruTorrent wiring, profile folder included
      'render-rutorrent-users',
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

describe('RunInstallation: what it records and tells the operator', () => {
  function reportingRunner(progress: string[]): RunInstallation {
    return new RunInstallation({
      facts: { gather: () => Promise.resolve(world.facts) },
      registry: world.registry,
      packages: world.packages,
      tearDownRetired: tearDownRetired(),
      installers: world.installers,
      catalog,
      enqueueConvergence: () => Promise.resolve(),
      drain: () => Promise.resolve(7),
      now: () => '2026-07-25 08:00:00',
      onProgress: (line) => progress.push(line),
    });
  }

  it('should_tell_the_operator_which_retired_service_it_stopped', async () => {
    await world.host.apply([
      { path: retired.unitFile, content: '[Unit]\n', mode: '0644', owner: 'root', group: 'root' },
    ]);
    const progress: string[] = [];

    await reportingRunner(progress).execute({ allowNonExt4: false });

    expect(progress[0]).toBe('kobox-engine: retired, stopped and removed');
  });

  it('should_list_every_preflight_failure_and_change_nothing', async () => {
    world.facts = { ...healthyFacts, euid: 1000 };

    const failure = runner().execute({ allowNonExt4: false });

    await expect(failure).rejects.toThrow(/^preflight failed .* nothing was changed:\n {2}- kobox install must run as root/);
    await expect(failure).rejects.toHaveProperty('name', 'PreflightFailedError');
  });

  it('should_let_a_non_ext4_root_through_when_the_operator_allows_it', async () => {
    world.facts = { ...healthyFacts, rootFsType: 'overlay' };

    const report = await runner().execute({ allowNonExt4: true });

    expect(report.installed).toEqual(['kobox-core', 'sshd', 'bind', 'fail2ban']);
  });

  it('should_refresh_the_package_index_when_a_single_component_is_left_to_install', async () => {
    await runner().execute({ allowNonExt4: false });
    await world.registry.reset(ComponentName.parse('bind'), '2026-07-25 09:00:00');

    await runner().execute({ allowNonExt4: false });

    expect(world.packages.refreshCount).toBe(2);
  });

  it('should_record_the_version_and_time_an_installer_reports', async () => {
    stub('sshd', () => ({ state: 'installed', version: '1:9.2p1-2' }));

    await runner().execute({ allowNonExt4: false });

    const record = await world.registry.get(ComponentName.parse('sshd'));
    expect(record?.version?.value).toBe('1:9.2p1-2');
    expect(record?.installedAt).toBe('2026-07-25 08:00:00');
    expect((await world.registry.get(ComponentName.parse('bind')))?.version).toBeUndefined();
  });

  it('should_record_why_a_component_was_skipped', async () => {
    stub('bind', () => ({ state: 'skipped', reason: 'not packaged here' }));

    await runner().execute({ allowNonExt4: false });

    expect((await world.registry.get(ComponentName.parse('bind')))?.reason).toBe('not packaged here');
  });

  it('should_return_how_many_convergence_jobs_were_drained', async () => {
    const report = await reportingRunner([]).execute({ allowNonExt4: false });

    expect(report.drainedJobs).toBe(7);
  });

  it('should_tell_the_operator_what_each_component_did', async () => {
    stub('sshd', () => ({ state: 'installed', detail: 'hard quotas active on /home' }));
    stub('bind', () => ({ state: 'skipped', reason: 'not packaged here' }));
    const progress: string[] = [];

    await reportingRunner(progress).execute({ allowNonExt4: false });

    // the progress lines separate the component's note with a dash
    expect(progress.map((line) => line.replace(/ \S /, ' - '))).toEqual([
      'installing kobox-core…',
      'kobox-core: installed',
      'installing sshd…',
      'sshd: installed - hard quotas active on /home',
      'installing bind…',
      'bind: skipped - not packaged here',
      'installing fail2ban…',
      'fail2ban: installed',
    ]);
  });

  it('should_say_a_component_stays_installed_when_a_rerun_lacks_its_pin', async () => {
    await runner().execute({ allowNonExt4: false });
    stub('bind', () => ({ state: 'skipped', reason: 'nothing pinned' }));
    const progress: string[] = [];

    await reportingRunner(progress).execute({ allowNonExt4: false });

    expect(progress).toContainEqual(expect.stringMatching(/^bind: left installed \S nothing pinned$/));
  });

  it('should_name_the_failed_component_and_its_cause', async () => {
    stub('bind', () => {
      throw new Error('named-checkconf exited 1');
    });

    const failure = runner().execute({ allowNonExt4: false });

    await expect(failure).rejects.toThrow(
      /^component bind failed: named-checkconf exited 1 .* fix the cause and re-run kobox install \(completed components are not redone\)$/,
    );
    await expect(failure).rejects.toMatchObject({ name: 'ComponentInstallError', component: 'bind' });
  });

  it('should_record_a_failure_that_is_not_an_error_object', async () => {
    stub('bind', () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a third-party installer may throw anything
      throw 'apt lock held';
    });

    await expect(runner().execute({ allowNonExt4: false })).rejects.toThrow(
      'component bind failed: apt lock held',
    );

    expect((await world.registry.get(ComponentName.parse('bind')))?.reason).toBe('apt lock held');
  });

  it('should_refuse_a_catalog_component_without_an_installer', async () => {
    world.installers.delete('sshd');

    await expect(runner().execute({ allowNonExt4: false })).rejects.toThrow(
      'component sshd failed: no installer registered',
    );
    expect(world.installers.get('bind')?.installCalls).toBe(0);
  });
});
