import type { Blocklist } from '../../../domain/tracker/Blocklist.js';
import type { Tracker } from '../../../domain/tracker/Tracker.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

function trackerChip(tracker: Tracker): RawHtml {
  if (tracker.isDead) {
    return html`<span class="chip bad">dead</span>`;
  }
  return tracker.isSsl
    ? html`<span class="chip ok">ssl</span>`
    : html`<span class="chip">plain</span>`;
}

export function adminTrackersPage(
  trackers: readonly Tracker[],
  viewer: Viewer,
  message?: string,
): string {
  const rows = trackers.map(
    (tracker) => html`<tr>
  <td class="mono">${tracker.host.value}</td>
  <td>${tracker.proto.value}:${tracker.port.value}</td>
  <td>${tracker.privacy.value}</td>
  <td class="mono">${tracker.certExpiry?.value ?? '—'}</td>
  <td>${trackerChip(tracker)}</td>
  <td>
    <form class="inline" method="post" action="/admin/trackers/fetch-cert">
      <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
      <input type="hidden" name="host" value="${tracker.host.value}">
      <button type="submit" class="ghost">Fetch cert</button>
    </form>
    ${tracker.isDead
      ? undefined
      : html`<form class="inline" method="post" action="/admin/trackers/mark-dead">
      <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
      <input type="hidden" name="host" value="${tracker.host.value}">
      <button type="submit" class="ghost danger">Mark dead</button>
    </form>`}
  </td>
</tr>`,
  );
  return page(
    'Trackers',
    html`<h1>Trackers</h1>
${flash(message)}
<form class="inline" method="post" action="/admin/trackers/renew-certs">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">Renew due certificates (queued)</button>
</form>
<table>
  <thead>
    <tr><th>Host</th><th>Endpoint</th><th>Privacy</th><th>Cert expiry</th><th>State</th><th>Actions</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}

export function adminBlocklistsPage(
  blocklists: readonly Blocklist[],
  viewer: Viewer,
  message?: string,
): string {
  const rows = blocklists.map(
    (list) => html`<tr>
  <td>${list.source.value}</td>
  <td>${list.author}</td>
  <td>${list.name}</td>
  <td>${list.enabled ? html`<span class="chip ok">enabled</span>` : html`<span class="chip">disabled</span>`}</td>
  <td>${list.lastUpdate === undefined
    ? '—'
    : list.lastUpdate.status === 'ok'
      ? html`<span class="chip ok">ok · ${list.lastUpdate.at}</span>`
      : html`<span class="chip bad">failed</span>`}</td>
</tr>`,
  );
  return page(
    'Blocklists',
    html`<h1>Blocklists</h1>
${flash(message)}
<form class="inline" method="post" action="/admin/blocklists/update">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">Update now (queued)</button>
</form>
<form class="inline" method="post" action="/admin/blocklists/import-catalog">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit" class="ghost">Import iblocklist catalog (queued)</button>
</form>
<table>
  <thead>
    <tr><th>Source</th><th>Author</th><th>Name</th><th>Enabled</th><th>Last update</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}
