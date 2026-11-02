// Reads the value of an XML-RPC methodResponse, as rtorrent writes it: strings,
// integers and arrays. A struct, a double or anything else rtorrent does not
// send for the calls KoBox makes is refused rather than guessed.

export type XmlRpcValue = string | number | readonly XmlRpcValue[];

// Array.isArray does not narrow a readonly array type: this guard does.
export function isList(value: XmlRpcValue): value is readonly XmlRpcValue[] {
  return Array.isArray(value);
}

export class MalformedXmlRpcError extends Error {
  constructor(reason: string) {
    super(`malformed XML-RPC response: ${reason}`);
    this.name = 'MalformedXmlRpcError';
  }
}

type Token =
  | { readonly kind: 'open'; readonly tag: string }
  | { readonly kind: 'close'; readonly tag: string }
  | { readonly kind: 'empty'; readonly tag: string }
  | { readonly kind: 'text'; readonly text: string };

const INTEGER_TAGS: ReadonlySet<string> = new Set(['i4', 'i8', 'int']);
const INTEGER_PATTERN = /^[+-]?\d+$/;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
const DECIMAL = 10;
const HEXADECIMAL = 16;

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (entity: string, name: string) => {
    if (name.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), HEXADECIMAL));
    }
    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), DECIMAL));
    }
    return NAMED_ENTITIES[name] ?? entity;
  });
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  // a processing instruction (<?xml ...?>) carries no value: drop it
  const body = xml.replace(/<\?[^>]*\?>/g, '');
  const pattern = /<(\/?)([A-Za-z][\w.]*)\s*(\/?)>|([^<]+)/g;
  for (const match of body.matchAll(pattern)) {
    const [, closing, tag, selfClosing, text] = match;
    if (text !== undefined) {
      tokens.push({ kind: 'text', text });
    } else if (tag !== undefined && closing === '/') {
      tokens.push({ kind: 'close', tag });
    } else if (tag !== undefined) {
      tokens.push({ kind: selfClosing === '/' ? 'empty' : 'open', tag });
    }
  }
  return tokens;
}

class Reader {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  // Whitespace between elements is layout, not content.
  private skipLayout(): void {
    while (this.isLayout(this.tokens[this.position])) {
      this.position += 1;
    }
  }

  private isLayout(token: Token | undefined): boolean {
    return token?.kind === 'text' && token.text.trim() === '';
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private next(): Token | undefined {
    const token = this.tokens[this.position];
    this.position += 1;
    return token;
  }

  expectOpen(tag: string): void {
    this.skipLayout();
    const token = this.next();
    if (token?.kind !== 'open' || token.tag !== tag) {
      throw new MalformedXmlRpcError(`expected <${tag}>`);
    }
  }

  expectClose(tag: string): void {
    this.skipLayout();
    const token = this.next();
    if (token?.kind !== 'close' || token.tag !== tag) {
      throw new MalformedXmlRpcError(`expected </${tag}>`);
    }
  }

  // The text up to the closing tag, empty when the element is.
  textUntilClose(tag: string): string {
    const token = this.peek();
    const text = token?.kind === 'text' ? token.text : '';
    if (token?.kind === 'text') {
      this.position += 1;
    }
    this.expectClose(tag);
    return text;
  }

  value(): XmlRpcValue {
    this.skipLayout();
    const start = this.next();
    if (start?.kind === 'empty' && start.tag === 'value') {
      return '';
    }
    if (start?.kind !== 'open' || start.tag !== 'value') {
      throw new MalformedXmlRpcError('expected <value>');
    }
    const inner = this.peek();
    // <value>text</value> with no type tag is a string
    if (inner?.kind === 'text' && !this.isLayout(inner)) {
      return unescapeXml(this.textUntilClose('value'));
    }
    this.skipLayout();
    const typed = this.next();
    if (typed?.kind === 'close' && typed.tag === 'value') {
      return '';
    }
    const content = this.typedContent(typed);
    this.expectClose('value');
    return content;
  }

  private typedContent(token: Token | undefined): XmlRpcValue {
    if (token?.kind === 'empty' && token.tag === 'string') {
      return '';
    }
    if (token?.kind !== 'open') {
      throw new MalformedXmlRpcError('expected a typed value');
    }
    if (token.tag === 'string') {
      return unescapeXml(this.textUntilClose('string'));
    }
    if (INTEGER_TAGS.has(token.tag)) {
      return this.integer(token.tag);
    }
    if (token.tag === 'array') {
      return this.array();
    }
    throw new MalformedXmlRpcError(`unsupported type <${token.tag}>`);
  }

  private integer(tag: string): number {
    const raw = this.textUntilClose(tag).trim();
    const parsed = Number(raw);
    if (!INTEGER_PATTERN.test(raw) || !Number.isSafeInteger(parsed)) {
      throw new MalformedXmlRpcError(`not an integer: ${JSON.stringify(raw)}`);
    }
    return parsed;
  }

  private array(): readonly XmlRpcValue[] {
    this.skipLayout();
    const data = this.next();
    if (data?.kind === 'empty' && data.tag === 'data') {
      this.expectClose('array');
      return [];
    }
    if (data?.kind !== 'open' || data.tag !== 'data') {
      throw new MalformedXmlRpcError('expected <data>');
    }
    const items: XmlRpcValue[] = [];
    this.skipLayout();
    while (this.peek()?.kind !== 'close') {
      items.push(this.value());
      this.skipLayout();
    }
    this.expectClose('data');
    this.expectClose('array');
    return items;
  }
}

// The single value a successful methodResponse carries. `response` may start
// with the SCGI status headers: reading begins at <methodResponse>.
export function readMethodResponse(response: string): XmlRpcValue {
  const start = response.indexOf('<methodResponse>');
  if (start < 0) {
    throw new MalformedXmlRpcError('no <methodResponse>');
  }
  const reader = new Reader(tokenize(response.slice(start)));
  reader.expectOpen('methodResponse');
  reader.expectOpen('params');
  reader.expectOpen('param');
  const value = reader.value();
  reader.expectClose('param');
  reader.expectClose('params');
  reader.expectClose('methodResponse');
  return value;
}
