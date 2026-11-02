import { InvalidSeedRuleError, SeedRule, type BoxSeedRule } from '../../domain/space/SeedRule.js';

// The rule an admin or a member typed, or nothing when the value object
// refuses it: the form then says which bounds it takes. A typed ratio keeps
// the box rule's type, as SeedRule.of does.
export function typedSeedRule(raw: {
  readonly ratio: number;
  readonly days: number;
}): BoxSeedRule | undefined;
export function typedSeedRule(raw: {
  readonly ratio: number | undefined;
  readonly days: number;
}): SeedRule | undefined;
export function typedSeedRule(raw: {
  readonly ratio: number | undefined;
  readonly days: number;
}): SeedRule | undefined {
  try {
    return SeedRule.of(raw);
  } catch (error) {
    if (error instanceof InvalidSeedRuleError) {
      return undefined;
    }
    throw error;
  }
}
