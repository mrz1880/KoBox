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
    html`<h1>${viewer.t('Trackers')}</h1>
<p class="muted">The trackers KoBox knows about, discovered from the torrents
members actually add. A <strong>private</strong> tracker is one that expects an
account; a <strong>public</strong> one is open to anyone. Members can be refused
public trackers individually, from their own page under Users.</p>
<p class="muted">KoBox watches the certificate of each https tracker and warns
before it expires, because an expired one stops announcing and torrents go quiet
without saying why. <strong>Renew certificates</strong> re-checks them all now
instead of waiting for the nightly pass. A tracker marked <strong>dead</strong>
is kept but no longer checked.</p>
${flash(message)}
<form class="inline" method="post" action="/admin/trackers/renew-certs">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">Renew certificates</button>
</form>
<table>
  <thead>
    <tr><th>${viewer.t('Host')}</th><th>Endpoint</th><th>${viewer.t('Privacy')}</th><th>Cert expiry</th><th>State</th><th>Actions</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}

// One form per row. The state used to be a chip you could read and not change,
// which is the whole complaint: the page reported a decision nobody could make.
function toggle(list: Blocklist, viewer: Viewer): RawHtml {
  return html`<form class="inline" method="post" action="/admin/blocklists/enabled">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <input type="hidden" name="source" value="${list.source.value}">
  <input type="hidden" name="author" value="${list.author}">
  <input type="hidden" name="name" value="${list.name}">
  <label class="check"><input type="checkbox" name="enabled" ${list.enabled ? html`checked` : html``}>
  in the filter</label>
  <button type="submit">${viewer.t('Save')}</button>
</form>`;
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
  <td>${toggle(list, viewer)}</td>
  <td>${list.lastUpdate === undefined
    ? '—'
    : list.lastUpdate.status === 'ok'
      ? html`<span class="chip ok">ok · ${list.lastUpdate.at}</span>`
      : html`<span class="chip bad">failed</span>`}</td>
</tr>`,
  );
  return page(
    'Blocklists',
    html`<h1>${viewer.t('Blocklists')}</h1>
<p class="muted">Lists of IP ranges that never get to talk to your members'
torrent clients: anti-piracy monitors, known bad actors, advertising networks.
Each list is published by someone else and fetched by KoBox; the merged ranges
go into the kernel's packet filter, so blocking costs nothing at transfer time.</p>
<p class="muted"><strong>Enabled</strong> is what decides whether a list counts:
a disabled one stays here for later and is not fetched. <strong>Update now</strong>
re-downloads every enabled list instead of waiting for the scheduled pass, and
<strong>Import catalog</strong> adds the well-known public lists so you can pick
from them rather than typing URLs.</p>
<p class="muted">None of this is a guarantee, and it is not a substitute for the
VPN under Account. It removes the loudest, best-known watchers.</p>
${flash(message)}
<form class="inline" method="post" action="/admin/blocklists/update">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">Update now</button>
</form>
<form class="inline" method="post" action="/admin/blocklists/import-catalog">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit" class="ghost">Import catalog</button>
</form>
<table>
  <thead>
    <tr><th>${viewer.t('Source')}</th><th>${viewer.t('Author')}</th><th>${viewer.t('Name')}</th><th>${viewer.t('Enabled')}</th><th>${viewer.t('Last update')}</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}
