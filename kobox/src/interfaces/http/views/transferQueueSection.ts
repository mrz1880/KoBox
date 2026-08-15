import type { SyncTransfer } from '../../../domain/sync/SyncTransfer.js';
import { html, type RawHtml } from '../html.js';
import type { Viewer } from './layout.js';

// The state in the member's words. "queued" and "pending" say nothing about
// what is happening to their file, or whether they need to do anything.
const STATE_WORDS: Readonly<Record<string, { readonly chip: string; readonly text: string }>> = {
  waiting: { chip: 'warn', text: 'waiting its turn' },
  sending: { chip: '', text: 'on its way' },
  sent: { chip: 'ok', text: 'arrived' },
  failed: { chip: 'bad', text: 'did not arrive' },
};

function row(transfer: SyncTransfer, viewer: Viewer): RawHtml {
  const words = STATE_WORDS[transfer.state] ?? { chip: '', text: transfer.state };
  return html`<tr>
  <td class="path">${transfer.name}</td>
  <td>${transfer.label.value}</td>
  <td><span class="chip ${words.chip}">${words.text}</span></td>
  <td class="reason">${transfer.lastError ?? ''}</td>
  <td class="when">${transfer.updatedAt}</td>
  <td>${
    transfer.state === 'failed'
      ? html`<form class="inline" method="post" action="/sync/transfers/retry">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <input type="hidden" name="id" value="${String(transfer.id ?? 0)}">
    <button class="ghost" type="submit">Try again</button>
  </form>`
      : html``
  }</td>
</tr>`;
}

export function transferQueueSection(
  transfers: readonly SyncTransfer[],
  viewer: Viewer,
): RawHtml {
  if (transfers.length === 0) {
    return html`<h2>What has been sent</h2>
<p class="muted">Nothing yet. Once a folder set to send finishes a download, it
turns up here.</p>`;
  }
  return html`<h2>What has been sent</h2>
<table>
  <thead>
    <tr><th>File</th><th>Folder</th><th>State</th><th>What happened</th><th>Last change</th><th></th></tr>
  </thead>
  <tbody>${transfers.map((transfer) => row(transfer, viewer))}</tbody>
</table>
<p class="muted">A file that did not arrive stays here until you try it again —
it is never silently dropped, and trying again resumes where it stopped rather
than starting the file over.</p>`;
}
