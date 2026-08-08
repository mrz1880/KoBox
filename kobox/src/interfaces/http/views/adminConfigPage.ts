import type { ConfigFileContent } from '../../../application/installation/ConfigFileReaderPort.js';
import { ConfigDocument } from '../../../domain/installation/ConfigDocument.js';
import { html, type RawHtml } from '../html.js';
import { page, type Viewer } from './layout.js';

// The list is the screen: an operator arrives asking "what did the installer
// decide about X", not "let me navigate to a path". Each entry says what the
// file decides before it says where it lives.
function index(selected: ConfigDocument | undefined): RawHtml {
  const rows = ConfigDocument.all().map((document) => {
    const current = document.id === selected?.id;
    return html`<tr${current ? html` class="current"` : html``}>
  <td><a href="/admin/config?file=${document.id}">${document.title}</a></td>
  <td class="muted">${document.purpose}</td>
  <td class="mono">${document.path}</td>
</tr>`;
  });
  return html`<table>
  <thead><tr><th>File</th><th>What it decides</th><th>Path</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function viewer_(document: ConfigDocument, found: ConfigFileContent | undefined): RawHtml {
  return html`<section class="panel">
  <div class="eyebrow">
    <span>${document.title}</span>
    <span class="mono">${document.path}</span>
  </div>
  <p class="muted">${document.purpose}</p>
  ${found === undefined
    ? html`<p class="lead">This file is not on this box.</p>
<p class="muted">That is normal when the component it belongs to was never
installed — no NFS means no exports file. Nothing is wrong.</p>`
    : html`${found.truncated
        ? html`<p class="muted">Showing the first 256 KB. The rest is on disk.</p>`
        : html``}
<pre class="log">${found.content}</pre>`}
</section>`;
}

export function adminConfigPage(
  selected: ConfigDocument | undefined,
  found: ConfigFileContent | undefined,
  viewer: Viewer,
): string {
  return page(
    'Config',
    html`<h1>Configuration</h1>
<p class="muted">Every file KoBox writes onto this box, as it is on disk right
now. Read-only, and only these files: this page cannot edit them, and it cannot
open anything else. Files holding a secret — the worker environment, the aria2
password, the VPN keys — are not listed and cannot be reached from here.</p>
${selected === undefined ? html`` : viewer_(selected, found)}
${index(selected)}`,
    viewer,
  );
}
