import { describe, expect, it } from 'vitest';
import { SetFairUseOverride } from '../../../../src/application/security/SetFairUseOverride.js';
import { Bandwidth } from '../../../../src/domain/security/Bandwidth.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryFairUseRepository } from '../../../../src/infrastructure/persistence/InMemoryFairUseRepository.js';

const alice = Username.parse('alice');
const NOW = '2026-07-25 10:00:00';

function world() {
  const fairUse = new InMemoryFairUseRepository();
  return { fairUse, useCase: new SetFairUseOverride({ fairUse }) };
}

describe('SetFairUseOverride', () => {
  it('should_set_budget_overrides_and_audit_the_change', async () => {
    const { fairUse, useCase } = world();

    await useCase.execute({
      username: alice,
      egressLimitBps: 10_000_000,
      authRatePerHour: 100,
      now: NOW,
    });

    const overrides = await fairUse.overridesFor(alice);
    expect(overrides?.sustainedEgress?.bps).toBe(10_000_000);
    expect(overrides?.maxAuthPerHour).toBe(100);
    expect(overrides?.throttleTo).toBeUndefined();
    const events = await fairUse.listEvents(alice);
    expect(events.at(-1)?.eventType).toBe('override-set');
  });

  it('should_merge_with_existing_overrides_and_clear_only_nulled_fields', async () => {
    const { fairUse, useCase } = world();
    await fairUse.saveOverrides(alice, {
      sustainedEgress: Bandwidth.bitsPerSecond(5_000_000),
      maxAuthPerHour: 50,
    });

    await useCase.execute({ username: alice, egressLimitBps: null, throttleToBps: 1_000_000, now: NOW });

    const overrides = await fairUse.overridesFor(alice);
    expect(overrides?.sustainedEgress).toBeUndefined(); // cleared
    expect(overrides?.maxAuthPerHour).toBe(50); // untouched
    expect(overrides?.throttleTo?.bps).toBe(1_000_000); // set
  });

  it('should_reject_invalid_bandwidth_values', async () => {
    const { useCase } = world();

    await expect(
      useCase.execute({ username: alice, egressLimitBps: 0, now: NOW }),
    ).rejects.toThrow();
  });
});
