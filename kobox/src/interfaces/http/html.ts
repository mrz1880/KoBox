// Tiny auto-escaping HTML template. Every interpolated value is escaped
// unless explicitly wrapped in raw() — the structural answer to the legacy
// portal's string-concatenated PHP/HTML (AUDIT §5.5).

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

class RawHtml {
  constructor(readonly value: string) {}
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export type HtmlValue = string | number | RawHtml | readonly HtmlValue[] | undefined;

function render(value: HtmlValue): string {
  if (value === undefined) {
    return '';
  }
  if (value instanceof RawHtml) {
    return value.value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(render).join('');
  }
  return escapeHtml(value as string);
}

export function html(strings: TemplateStringsArray, ...values: readonly HtmlValue[]): RawHtml {
  let out = '';
  strings.forEach((part, index) => {
    out += part;
    if (index < values.length) {
      out += render(values[index]);
    }
  });
  return new RawHtml(out);
}

export type { RawHtml };
