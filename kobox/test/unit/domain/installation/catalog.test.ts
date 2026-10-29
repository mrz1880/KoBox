import { describe, expect, it } from 'vitest';
import type { ComponentSpec } from '../../../../src/domain/installation/catalog.js';

// The catalog is built (and its names parsed) when the module loads: imported
// inside each test, a load-time failure fails that test instead of the file.
async function catalog(): Promise<readonly ComponentSpec[]> {
  return (await import('../../../../src/domain/installation/catalog.js')).COMPONENT_CATALOG;
}

async function dependenciesOf(name: string): Promise<readonly string[]> {
  const spec = (await catalog()).find((candidate) => candidate.name.value === name);
  if (spec === undefined) {
    throw new Error(`${name} is not in the catalog`);
  }
  return spec.dependsOn.map((dep) => dep.value);
}

describe('COMPONENT_CATALOG', () => {
  it('should_declare_every_installable_component_in_tie_breaking_order', async () => {
    // the declared order is the topological sort's tie-breaker, so it decides
    // the install order of every component that does not depend on another
    expect((await catalog()).map((spec) => spec.name.value)).toEqual([
      'kobox-core',
      'apt-sources',
      'sshd',
      'tweaks',
      'quota',
      'dnscrypt',
      'bind',
      'nginx',
      'rtorrent',
      'rutorrent',
      'ipset',
      'fail2ban',
      'openvpn',
      'postfix',
      'letsencrypt',
      'scheduler',
      'portal',
      'nfs',
      'samba',
      'shellinabox',
      'nanomon',
      'aria2',
      'speedtest',
      'nextcloud',
    ]);
  });

  it('should_leave_the_base_components_free_of_dependencies', async () => {
    for (const base of [
      'kobox-core',
      'apt-sources',
      'sshd',
      'tweaks',
      'quota',
      'dnscrypt',
      'nginx',
      'rtorrent',
      'ipset',
      'openvpn',
      'postfix',
    ]) {
      expect(await dependenciesOf(base), base).toEqual([]);
    }
  });

  it.each([
    ['bind', ['dnscrypt']],
    ['rutorrent', ['nginx', 'rtorrent']],
    ['fail2ban', ['sshd']],
    ['letsencrypt', ['nginx']],
    ['scheduler', ['kobox-core']],
    ['portal', ['kobox-core', 'nginx']],
    ['nfs', ['kobox-core']],
    ['samba', ['kobox-core']],
    ['shellinabox', ['nginx']],
    ['nanomon', ['nginx']],
    ['aria2', ['kobox-core']],
    ['speedtest', ['kobox-core']],
    ['nextcloud', ['nginx', 'kobox-core']],
  ])('should_install_%s_only_after_%j', async (component, dependencies) => {
    expect(await dependenciesOf(component)).toEqual(dependencies);
  });
});
