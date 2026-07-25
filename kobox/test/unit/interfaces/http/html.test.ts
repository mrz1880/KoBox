import { describe, expect, it } from 'vitest';
import { html, raw } from '../../../../src/interfaces/http/html.js';

describe('html tagged template', () => {
  it('should_escape_interpolated_values_by_default', () => {
    const out = html`<p>${'<script>alert("x")</script>'}</p>`;

    expect(out.value).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  });

  it('should_pass_raw_fragments_and_nested_templates_through', () => {
    const inner = html`<b>${'a & b'}</b>`;
    const out = html`<div>${raw('<hr>')}${inner}</div>`;

    expect(out.value).toBe('<div><hr><b>a &amp; b</b></div>');
  });

  it('should_render_arrays_and_skip_undefined', () => {
    const out = html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}${undefined}</ul>`;

    expect(out.value).toBe('<ul><li>1</li><li>2</li></ul>');
  });
});
