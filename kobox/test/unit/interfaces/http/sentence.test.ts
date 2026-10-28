import { describe, expect, it } from 'vitest';
import { html } from '../../../../src/interfaces/http/html.js';
import { sentence } from '../../../../src/interfaces/http/views/layout.js';
import type { Translate } from '../../../../src/interfaces/http/views/messages.js';

describe('a translated sentence carrying markup', () => {
  it('should_put_the_markup_where_the_translation_places_it', () => {
    const t: Translate = () => 'Créez-en un dans {folders}, puis revenez.';

    const out = sentence(t, 'Create one under {folders}, then come back.', {
      folders: html`<a href="/sync">Dossiers</a>`,
    });

    expect(out.value).toBe('Créez-en un dans <a href="/sync">Dossiers</a>, puis revenez.');
  });

  it('should_escape_the_sentence_itself_like_any_text', () => {
    const t: Translate = () => 'a < b & {value}';

    const out = sentence(t, 'a < b & {value}', { value: html`<b>${'c'}</b>` });

    expect(out.value).toBe('a &lt; b &amp; <b>c</b>');
  });
});
