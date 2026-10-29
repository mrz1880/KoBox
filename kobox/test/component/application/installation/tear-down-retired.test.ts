import { beforeEach, describe, expect, it } from 'vitest';
import { TearDownRetiredServices } from '../../../../src/application/installation/TearDownRetiredServices.js';
import type { RetiredService } from '../../../../src/domain/installation/retired.js';
import { FakeInstallHost } from '../../../../src/infrastructure/system/fakes/FakeInstallHost.js';
import { FakeSystemd } from '../../../../src/infrastructure/system/fakes/FakeSystemd.js';

const engine: RetiredService = {
  unit: 'kobox-engine',
  unitFile: '/etc/systemd/system/kobox-engine.service',
  files: ['/etc/kobox/engine.conf'],
  dirs: ['/var/lib/kobox-engine'],
};

let host: FakeInstallHost;
let systemd: FakeSystemd;

function placeOnDisk(path: string): Promise<readonly string[]> {
  return host.apply([{ path, content: 'left by an earlier release\n', mode: '0644', owner: 'root', group: 'root' }]);
}

function tearDown(): TearDownRetiredServices {
  return new TearDownRetiredServices({ host, systemd, retired: [engine] });
}

beforeEach(() => {
  host = new FakeInstallHost();
  systemd = new FakeSystemd();
});

describe('tearing down a retired service', () => {
  it('should_stop_it_and_take_away_everything_it_installed', async () => {
    await placeOnDisk(engine.unitFile);
    await placeOnDisk('/etc/kobox/engine.conf');
    await host.ensureDir('/var/lib/kobox-engine', '0750');
    await systemd.enable('kobox-engine', { now: true });

    const torn = await tearDown().execute();

    expect(torn).toEqual(['kobox-engine']);
    expect(systemd.log.slice(-2)).toEqual(['disable-now kobox-engine', 'daemon-reload']);
    expect(await systemd.isActive('kobox-engine')).toBe(false);
    expect(await host.pathExists(engine.unitFile)).toBe(false);
    expect(await host.pathExists('/etc/kobox/engine.conf')).toBe(false);
    expect(await host.pathExists('/var/lib/kobox-engine')).toBe(false);
  });

  it('should_cost_a_box_that_never_ran_it_no_systemctl_call', async () => {
    const torn = await tearDown().execute();

    // a fresh box, or the second upgrade after the first one cleaned up
    expect(torn).toEqual([]);
    expect(systemd.log).toEqual([]);
  });

  it('should_still_clear_what_an_interrupted_teardown_left_behind', async () => {
    // the unit went, then the run stopped: the files must not stay forever
    await placeOnDisk('/etc/kobox/engine.conf');
    await host.ensureDir('/var/lib/kobox-engine', '0750');

    await tearDown().execute();

    expect(await host.pathExists('/etc/kobox/engine.conf')).toBe(false);
    expect(await host.pathExists('/var/lib/kobox-engine')).toBe(false);
    expect(systemd.log).toEqual([]);
  });
});
