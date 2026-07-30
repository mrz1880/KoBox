import type { DebridDownload } from '../../../domain/ddl/DebridDownload.js';
import { VPN_VARIANTS } from '../../../domain/security/vpn.js';
import type { FairUseState } from '../../../domain/security/ports.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

const VARIANT_LABELS: Record<string, string> = {
  'tun-gw': 'TUN with gateway (all traffic)',
  tun: 'TUN split (seedbox only)',
  tap: 'TAP bridge',
};

function statusChip(user: SeedboxUser): RawHtml {
  return user.status.isSuspended()
    ? html`<span class="chip bad">suspended</span>`
    : html`<span class="chip ok">active</span>`;
}

function levelChip(state: FairUseState): RawHtml {
  if (state.level === 'throttled') {
    return html`<span class="chip bad">throttled</span>`;
  }
  if (state.level === 'alerted') {
    return html`<span class="chip warn">alerted</span>`;
  }
  return html`<span class="chip ok">nominal</span>`;
}

export function userHomePage(
  user: SeedboxUser,
  fairUse: FairUseState,
  viewer: Viewer,
  message?: string,
): string {
  return page(
    'Home',
    html`<h1>Hello ${user.username.value} ${statusChip(user)}</h1>
${flash(message)}
<div class="card">
  <p>Quota: <span class="mono">${user.quota.toGib()} GiB</span><br>
  Fair use: ${levelChip(fairUse)}<br>
  SCGI port: <span class="mono">${user.scgiPort.value}</span></p>
  <p><a href="/access">My access &amp; VPN profiles</a> ·
  <a href="/rutorrent">Open ruTorrent</a> ·
  <a href="/password">Change password</a></p>
</div>`,
    viewer,
  );
}

export interface FleetRow {
  readonly username: string;
  readonly status: string;
  readonly level: string;
}

export function adminHomePage(
  rows: readonly FleetRow[],
  viewer: Viewer,
  message?: string,
): string {
  const active = rows.filter((row) => row.status === 'active').length;
  const throttled = rows.filter((row) => row.level === 'throttled').length;
  const tableRows = rows.map(
    (row) => html`<tr>
  <td><a href="/admin/users/${row.username}">${row.username}</a></td>
  <td>${row.status}</td>
  <td>${row.level}</td>
</tr>`,
  );
  return page(
    'Overview',
    html`<h1>Fleet overview</h1>
${flash(message)}
<div class="card">
  <p>${active}/${rows.length} users active · ${throttled} throttled</p>
  <p><a href="/admin/users">Manage users</a> ·
  <a href="/admin/fair-use">Fair use</a> ·
  <a href="/admin/health">Health</a></p>
</div>
<table>
  <thead><tr><th>User</th><th>Status</th><th>Fair use</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>`,
    viewer,
  );
}

export function passwordPage(viewer: Viewer, error?: string, ok?: string): string {
  return page(
    'Password',
    html`<h1>Change password</h1>
${flash(ok)}
${flash(error, 'error')}
<form class="card" method="post" action="/password">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="current">Current password</label>
  <input id="current" name="current" type="password" autocomplete="current-password" required>
  <label for="next">New password</label>
  <input id="next" name="next" type="password" autocomplete="new-password" required minlength="8">
  <button type="submit">Change (queued)</button>
</form>`,
    viewer,
  );
}

export function accessPage(viewer: Viewer): string {
  const rows = VPN_VARIANTS.map(
    (variant) => html`<tr>
  <td>${VARIANT_LABELS[variant] ?? variant}</td>
  <td><a href="/access/ovpn/${variant}">Download kobox-${variant}.ovpn</a></td>
</tr>`,
  );
  return page(
    'My access',
    html`<h1>My access</h1>
<div class="card">
  <p>Apps: <a href="/ru/">ruTorrent</a> · <a href="/rutorrent">framed view</a></p>
</div>
<h2>OpenVPN profiles</h2>
<table>
  <thead><tr><th>Profile</th><th>Download</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}

function downloadStatusChip(status: DebridDownload['status']): RawHtml {
  switch (status) {
    case 'done':
      return html`<span class="chip ok">done</span>`;
    case 'failed':
      return html`<span class="chip bad">failed</span>`;
    case 'downloading':
      return html`<span class="chip warn">downloading</span>`;
    default:
      return html`<span class="chip">pending</span>`;
  }
}

// The per-user debrid account panel. It never echoes the key back — not even
// sealed: the only states shown are "configured" and "not configured".
function debridAccountCard(viewer: Viewer, hasKey: boolean): RawHtml {
  return html`<div class="card">
  <h2>My AllDebrid account</h2>
  <p>Status: ${hasKey
    ? html`<span class="chip ok">key configured</span>`
    : html`<span class="chip warn">no key</span>`}<br>
  <span class="muted">Your key is stored encrypted and is only used for your own
  downloads. Without one, downloads stay unavailable for you — nothing else changes.</span></p>
  <form method="post" action="/downloads/debrid-key">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <label for="apiKey">${hasKey ? 'Replace my key' : 'My AllDebrid API key'}</label>
    <input id="apiKey" name="apiKey" type="password" autocomplete="off" required>
    <button type="submit">Save</button>
  </form>
  ${hasKey
    ? html`<form class="inline" method="post" action="/downloads/debrid-key/clear">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button class="ghost" type="submit">Remove my key</button>
  </form>`
    : undefined}
</div>`;
}

export function downloadsPage(
  viewer: Viewer,
  downloads: readonly DebridDownload[],
  hasKey: boolean,
  message?: string,
  error?: string,
): string {
  const rows =
    downloads.length === 0
      ? html`<tr><td colspan="4">No downloads yet.</td></tr>`
      : downloads.map(
          (download) => html`<tr>
  <td>${download.category.value}</td>
  <td>${downloadStatusChip(download.status)}</td>
  <td class="mono">${download.filename ?? download.error ?? download.sourceLink.value}</td>
  <td class="mono">${download.createdAt}</td>
</tr>`,
        );
  return page(
    'Downloads',
    html`<h1>Downloads</h1>
${flash(message)}
${flash(error, 'error')}
${debridAccountCard(viewer, hasKey)}
<form class="card" method="post" action="/downloads">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="link">Filehoster link</label>
  <input id="link" name="link" type="url" inputmode="url" placeholder="https://…" required>
  <label for="category">Category</label>
  <select id="category" name="category">
    <option value="films">Films</option>
    <option value="series">Series</option>
  </select>
  <button type="submit">Download (queued)</button>
</form>
<table>
  <thead><tr><th>Category</th><th>Status</th><th>Detail</th><th>Requested</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}

export function rutorrentPage(viewer: Viewer, message?: string): string {
  return page(
    'ruTorrent',
    html`<h1>ruTorrent</h1>
${flash(message)}
<form class="inline" method="post" action="/rutorrent/restart">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button class="ghost" type="submit">Restart my rtorrent</button>
  <span class="muted">Use this if the interface stops responding.</span>
</form>
<iframe class="app" src="/ru/" title="ruTorrent"></iframe>`,
    viewer,
  );
}

export function monitoringPage(viewer: Viewer): string {
  return page(
    'Monitoring',
    html`<h1>Monitoring</h1>
<iframe class="app" src="/monitoring/" title="Monitoring"></iframe>`,
    viewer,
  );
}
