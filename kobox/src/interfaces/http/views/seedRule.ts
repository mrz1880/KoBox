import type { SeedRule } from '../../../domain/space/SeedRule.js';
import type { Reader } from './layout.js';
import { formatRatio } from './ratio.js';

// A number of days in the reader's words, one day or several.
// Whether a count takes the singular in the reader's language.
export function isSingular(count: number, reader: Reader): boolean {
  return new Intl.PluralRules(reader.language.value).select(count) === 'one';
}

export function daysPhrase(days: number, reader: Reader): string {
  return reader.t(isSingular(days, reader) ? '{days} day' : '{days} days', { days: String(days) });
}

// What a seed rule asks, in a few words: the ratio first when it asks one.
export function seedRuleSummary(rule: SeedRule, reader: Reader): string {
  const days = daysPhrase(rule.days, reader);
  return rule.ratio === undefined
    ? days
    : reader.t('ratio {ratio}, {days}', { ratio: formatRatio(rule.ratio, reader), days });
}
