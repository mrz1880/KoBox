import { html } from '../html.js';
import type { AdminGroup } from './adminGroups.js';
import { page, type Viewer } from './layout.js';

export function adminGroupPage(group: AdminGroup, viewer: Viewer): string {
  return page(
    group.title,
    html`<h1>${viewer.t(group.title)}</h1>
<p class="lead">${group.intro}</p>
<div class="choices">${group.entries.map(
      (entry) => html`<div class="choice">
  ${entry.tag === undefined ? undefined : html`<span class="tag">${entry.tag}</span>`}
  <h3>${entry.title}</h3>
  <p>${entry.blurb}</p>
  <a class="action" href="${entry.href}">Open</a>
</div>`,
    )}</div>`,
    viewer,
    'admin',
  );
}
