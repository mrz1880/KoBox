import { html } from '../html.js';
import type { AdminGroup } from './adminGroups.js';
import { page, type Viewer } from './layout.js';

export function adminGroupPage(group: AdminGroup, viewer: Viewer): string {
  return page(
    group.title,
    html`<h1>${viewer.t(group.title)}</h1>
<p class="lead">${viewer.t(group.intro)}</p>
<div class="choices">${group.entries.map(
      (entry) => html`<div class="choice">
  ${entry.tag === undefined ? undefined : html`<span class="tag">${viewer.t(entry.tag)}</span>`}
  <h3>${viewer.t(entry.title)}</h3>
  <p>${viewer.t(entry.blurb)}</p>
  <a class="action" href="${entry.href}">${viewer.t('Open')}</a>
</div>`,
    )}</div>`,
    viewer,
    'admin',
  );
}
