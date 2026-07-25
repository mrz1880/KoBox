import { describe, expect, it } from 'vitest';
import { evaluatePreflight } from '../../../../src/domain/installation/preflight.js';
import type { SystemFacts } from '../../../../src/domain/installation/ports.js';

const healthyBox: SystemFacts = {
  osId: 'debian',
  osVersionId: '12',
  arch: 'amd64',
  euid: 0,
  rootFsType: 'ext4',
  hasDefaultRoute: true,
  hasTunDevice: true,
};

describe('evaluatePreflight', () => {
  it('should_pass_on_a_healthy_debian_12_root_box', () => {
    expect(evaluatePreflight(healthyBox, { allowNonExt4: false })).toEqual([]);
  });

  it('should_fail_on_non_debian_or_wrong_version', () => {
    const ubuntu = evaluatePreflight(
      { ...healthyBox, osId: 'ubuntu', osVersionId: '24.04' },
      { allowNonExt4: false },
    );
    expect(ubuntu.some((f) => f.check === 'os')).toBe(true);

    const debian11 = evaluatePreflight(
      { ...healthyBox, osVersionId: '11' },
      { allowNonExt4: false },
    );
    expect(debian11.some((f) => f.check === 'os')).toBe(true);
  });

  it('should_fail_when_not_root', () => {
    const failures = evaluatePreflight({ ...healthyBox, euid: 1000 }, { allowNonExt4: false });
    expect(failures.some((f) => f.check === 'root')).toBe(true);
  });

  it('should_fail_on_unsupported_architecture', () => {
    const failures = evaluatePreflight({ ...healthyBox, arch: 'i386' }, { allowNonExt4: false });
    expect(failures.some((f) => f.check === 'arch')).toBe(true);
  });

  it('should_accept_arm64_for_dev_containers', () => {
    expect(evaluatePreflight({ ...healthyBox, arch: 'arm64' }, { allowNonExt4: false })).toEqual(
      [],
    );
  });

  it('should_fail_on_non_ext4_root_unless_explicitly_allowed', () => {
    const overlay = { ...healthyBox, rootFsType: 'overlay' };
    expect(
      evaluatePreflight(overlay, { allowNonExt4: false }).some((f) => f.check === 'filesystem'),
    ).toBe(true);
    expect(evaluatePreflight(overlay, { allowNonExt4: true })).toEqual([]);
  });

  it('should_fail_without_a_default_route', () => {
    const failures = evaluatePreflight(
      { ...healthyBox, hasDefaultRoute: false },
      { allowNonExt4: false },
    );
    expect(failures.some((f) => f.check === 'network')).toBe(true);
  });

  it('should_report_every_failure_at_once_with_actionable_messages', () => {
    const failures = evaluatePreflight(
      { ...healthyBox, euid: 1000, rootFsType: 'btrfs', hasDefaultRoute: false },
      { allowNonExt4: false },
    );
    expect(failures).toHaveLength(3);
    for (const failure of failures) {
      expect(failure.message.length).toBeGreaterThan(10);
    }
  });
});
