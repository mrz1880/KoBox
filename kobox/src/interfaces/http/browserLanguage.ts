import { LANGUAGES, Language } from '../../domain/portal/Language.js';

// What a member reads when they never chose: the first language their browser
// asks for that the portal speaks, by the weights it sends, else English.
const FALLBACK = Language.en;

// A tag sent without a q= weight counts as fully wanted (RFC 9110).
const DEFAULT_WEIGHT = 1;

const WEIGHT = /^\s*q=([0-9.]+)\s*$/;

interface Wish {
  readonly primary: string;
  readonly weight: number;
  readonly index: number;
}

function wishOf(part: string, index: number): Wish {
  const [tag = '', ...params] = part.trim().split(';');
  const q = params.map((param) => WEIGHT.exec(param)?.[1]).find((v) => v !== undefined);
  return {
    // en-US, en-GB and en all mean the same English here
    primary: (tag.split('-')[0] ?? '').toLowerCase(),
    weight: q === undefined ? DEFAULT_WEIGHT : Number(q),
    index,
  };
}

export function browserLanguage(header: string | undefined): Language {
  const first = (header ?? '')
    .split(',')
    .map(wishOf)
    .filter((wish) => wish.weight > 0 && LANGUAGES.some((ours) => ours === wish.primary))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)[0];
  return first === undefined ? FALLBACK : Language.parse(first.primary);
}
