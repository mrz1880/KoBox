import { Bandwidth } from '../../domain/security/Bandwidth.js';
import type { FairUseOverrides } from '../../domain/security/FairUsePolicy.js';
import type { FairUseRepository } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';

// Per-field tri-state: undefined = leave untouched, null = clear back to the
// installation default, number = override for this user.
export interface SetFairUseOverrideCommand {
  readonly username: Username;
  readonly egressLimitBps?: number | null;
  readonly authRatePerHour?: number | null;
  readonly throttleToBps?: number | null;
  readonly now: string;
}

interface Deps {
  readonly fairUse: FairUseRepository;
}

export class SetFairUseOverride {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetFairUseOverrideCommand): Promise<void> {
    const { fairUse } = this.deps;
    const existing = (await fairUse.overridesFor(command.username)) ?? {};

    const sustainedEgress = mergeBandwidth(existing.sustainedEgress, command.egressLimitBps);
    const maxAuthPerHour = mergeCount(existing.maxAuthPerHour, command.authRatePerHour);
    const throttleTo = mergeBandwidth(existing.throttleTo, command.throttleToBps);
    const overrides: FairUseOverrides = {
      ...(sustainedEgress !== undefined && { sustainedEgress }),
      ...(maxAuthPerHour !== undefined && { maxAuthPerHour }),
      ...(throttleTo !== undefined && { throttleTo }),
    };

    await fairUse.saveOverrides(command.username, overrides);
    await fairUse.appendEvent(
      command.username,
      'override-set',
      JSON.stringify({
        sustainedEgressBps: sustainedEgress?.bps ?? null,
        maxAuthPerHour: maxAuthPerHour ?? null,
        throttleToBps: throttleTo?.bps ?? null,
      }),
      command.now,
    );
  }
}

function mergeBandwidth(
  current: Bandwidth | undefined,
  requested: number | null | undefined,
): Bandwidth | undefined {
  if (requested === undefined) {
    return current;
  }
  return requested === null ? undefined : Bandwidth.bitsPerSecond(requested);
}

function mergeCount(
  current: number | undefined,
  requested: number | null | undefined,
): number | undefined {
  if (requested === undefined) {
    return current;
  }
  return requested ?? undefined;
}
