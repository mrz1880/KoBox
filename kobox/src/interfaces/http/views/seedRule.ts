import type { SeedRule } from '../../../domain/space/SeedRule.js';
import type { Reader } from './layout.js';
import { formatRatio } from './ratio.js';

// A number of days in the reader's words, one day or several.
export function daysPhrase(days: number, reader: Reader): string {
  const one = new Intl.PluralRules(reader.language.value).select(days) === 'one';
  return reader.t(one ? '{days} day' : '{days} days', { days: String(days) });
}

// What a seed rule asks, in a few words: the ratio first when it asks one.
export function seedRuleSummary(rule: SeedRule, reader: Reader): string {
  const days = daysPhrase(rule.days, reader);
  return rule.ratio === undefined
    ? days
    : reader.t('ratio {ratio}, {days}', { ratio: formatRatio(rule.ratio, reader), days });
}
