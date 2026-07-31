import type { DebridDownload } from '../../../domain/ddl/DebridDownload.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

function fairUseChip(level: string): RawHtml {
  if (level === 'throttled') {
    return html`<span class="chip bad">throttled</span>`;
  }
  return level === 'alerted'
    ? html`<span class="chip warn">alerted</span>`
    : html`<span class="chip ok">within fair use</span>`;
}

// What the portal can honestly know about a user from the database alone.
// Disk usage is deliberately absent: it needs root-only quota tooling, so it is
// not shown rather than guessed at.
export interface SignalRow {
  readonly username: string;
  readonly suspended: boolean;
  readonly healthy: boolean;
  readonly level: string;
  readonly egressBytes: number;
  readonly quotaGib: number;
  // Full-scale reference for the meter, in bytes. On the fleet console this is
  // the loudest channel, so the desk reads comparatively and an outlier pins the
  // meter. Omitted where there is nothing honest to compare against (a user
  // looking at their own channel), and then no meter is drawn — the fair-use
  // verdict is carried by the LED and the level, which are authoritative.
  readonly scaleBytes?: number;
  readonly linked?: boolean;
  // shown instead of the username on a self view, where the page title already
  // names the person and repeating it says nothing
  readonly label?: string;
}

const VU_SEGMENTS = 24;
// the shoulder and peak zones of the meter, in segments
const VU_WARN_AT = 15;
const VU_PEAK_AT = 19;

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1024) {
    return `${(gib / 1024).toFixed(2)} TiB`;
  }
  return gib >= 10 || gib === 0 ? `${gib.toFixed(0)} GiB` : `${gib.toFixed(1)} GiB`;
}

// Segments, not a smooth bar: the eye reads a channel running into the red long
// before it reads a percentage.
function vuMeter(egressBytes: number, scaleBytes: number): RawHtml {
  const ratio = scaleBytes > 0 ? egressBytes / scaleBytes : 0;
  const lit = Math.min(VU_SEGMENTS, Math.round(ratio * VU_SEGMENTS));
  const segments = Array.from({ length: VU_SEGMENTS }, (_unused, index) => {
    if (index >= lit) {
      return html`<i class="${index >= VU_PEAK_AT ? 'zone' : ''}"></i>`;
    }
    const tone = index >= VU_PEAK_AT ? ' peak' : index >= VU_WARN_AT ? ' warn' : '';
    return html`<i class="on${tone}"></i>`;
  });
  return html`<div class="vu" role="img"
    aria-label="Egress ${formatBytes(egressBytes)}, busiest channel ${formatBytes(scaleBytes)}">${segments}</div>`;
}

function ledClass(row: SignalRow): string {
  if (row.suspended) {
    return 'off';
  }
  if (!row.healthy || row.level === 'throttled') {
    return 'bad';
  }
  return row.level === 'alerted' ? 'warn' : '';
}

function stateWords(row: SignalRow): string {
  const service = row.suspended ? 'suspended' : row.healthy ? 'active' : 'service down';
  return row.level === 'none' ? service : `${service} · ${row.level}`;
}

export function signalStrip(row: SignalRow): RawHtml {
  const name =
    row.linked === true
      ? html`<a href="/admin/users/${row.username}">${row.username}</a>`
      : html`<span class="name">${row.label ?? row.username}</span>`;
  return html`<div class="strip">
  <span class="led ${ledClass(row)}"></span>
  <span class="who">${name}<span class="eyebrow">${stateWords(row)}</span></span>
  ${row.scaleBytes !== undefined && row.scaleBytes > 0
    ? vuMeter(row.egressBytes, row.scaleBytes)
    : html`<span>${fairUseChip(row.level)}</span>`}
  <span class="figures"><b>${formatBytes(row.egressBytes)}</b> sent ·
  ${row.quotaGib} GiB allowance</span>
</div>`;
}

export function userHomePage(
  user: SeedboxUser,
  viewer: Viewer,
  row: SignalRow,
  message?: string,
): string {
  return page(
    'Home',
    html`<h1>Hello ${user.username.value}</h1>
${flash(message)}
${signalStrip({ ...row, label: 'Your channel' })}
<p class="muted">SCGI port <span class="mono">${user.scgiPort.value}</span></p>
<p class="links"><a href="/downloads">Downloads</a> ·
<a href="/access">My access &amp; VPN profiles</a> ·
<a href="/rutorrent">Open ruTorrent</a> ·
<a href="/password">Change password</a></p>`,
    viewer,
  );
}

export type FleetRow = SignalRow;

// The fleet console: an aggregate ribbon, then one channel per user. The strips
// are ordered loudest-first, so whoever is pushing the most egress is at the top
// of the desk rather than buried in alphabetical order.
export function adminHomePage(
  rows: readonly FleetRow[],
  viewer: Viewer,
  message?: string,
): string {
  const active = rows.filter((row) => !row.suspended).length;
  const flagged = rows.filter((row) => row.level !== 'none').length;
  const down = rows.filter((row) => !row.healthy && !row.suspended).length;
  const totalEgress = rows.reduce((sum, row) => sum + row.egressBytes, 0);
  const loudestFirst = [...rows].sort((a, b) => b.egressBytes - a.egressBytes);
  // full scale = the busiest channel, so the desk is read by comparison
  const scaleBytes = loudestFirst[0]?.egressBytes ?? 0;
  return page(
    'Overview',
    html`<h1>Fleet console</h1>
${flash(message)}
<div class="ribbon">
  <span class="metric"><span class="eyebrow">Users active</span>
    <span class="val">${active}/${rows.length}</span></span>
  <span class="metric"><span class="eyebrow">Egress this window</span>
    <span class="val">${formatBytes(totalEgress)}</span></span>
  <span class="metric"><span class="eyebrow">Over fair use</span>
    <span class="val${flagged > 0 ? ' alert' : ''}">${flagged}</span></span>
  <span class="metric"><span class="eyebrow">Service down</span>
    <span class="val${down > 0 ? ' bad' : ''}">${down}</span></span>
</div>
<h2>Channels</h2>
<p class="muted">Meters run full scale at the busiest channel
(${formatBytes(scaleBytes)}). Loudest first.</p>
${loudestFirst.map((row) => signalStrip({ ...row, scaleBytes, linked: true }))}
<p class="links"><a href="/admin/users">Manage users</a> ·
<a href="/admin/fair-use">Fair use</a> ·
<a href="/admin/health">Health</a></p>`,
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
  <button type="submit">Change password</button>
</form>`,
    viewer,
  );
}

// What a person actually came here to do: get connected. That means choosing a
// profile — so the three variants are presented as a choice, each carrying the
// sentence that tells you whether it is yours — and then knowing their own
// connection details, which the page previously never showed at all.
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

// A finished download shows its file, a running one its source, a failed one the
// reason. The first two are data and read as mono; a reason is a sentence meant
// to be read, so it is set as prose with the API code kept scannable beside it.
function detailCell(download: DebridDownload): RawHtml {
  if (download.filename !== undefined) {
    return html`<span class="path">${download.filename}</span>`;
  }
  if (download.error !== undefined) {
    const match = /^debrid error ([A-Z_]+): (.*)$/s.exec(download.error);
    return match === null
      ? html`<span class="reason">${download.error}</span>`
      : html`<span class="reason"><code>${match[1] ?? ''}</code>${match[2] ?? ''}</span>`;
  }
  return html`<span class="path">${download.sourceLink.value}</span>`;
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
      ? html`<tr><td colspan="4">Nothing here yet. Submit a link above to start.</td></tr>`
      : downloads.map(
          (download) => html`<tr>
  <td>${download.category.value}</td>
  <td>${downloadStatusChip(download.status)}</td>
  <td>${detailCell(download)}</td>
  <td class="when">${download.createdAt}</td>
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
  <button type="submit">Start download</button>
</form>
<table>
  <thead><tr><th>Category</th><th>Status</th><th>Detail</th><th>Requested</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}


const VPN_CHOICES: readonly {
  readonly variant: string;
  readonly title: string;
  readonly blurb: string;
  readonly usual?: boolean;
}[] = [
  {
    variant: 'tun-gw',
    title: 'Everything through the seedbox',
    blurb: 'All your traffic leaves through the server. Pick this one unless you have a reason not to.',
    usual: true,
  },
  {
    variant: 'tun',
    title: 'Seedbox traffic only',
    blurb: 'Only what you send to the seedbox goes through the tunnel. The rest uses your normal connection.',
  },
  {
    variant: 'tap',
    title: 'Bridged network',
    blurb: 'Puts your machine on the same network as the server. Rarely needed.',
  },
];

export interface AccessFacts {
  readonly username: string;
  readonly sftpHost?: string;
  readonly rtorrentPort: number;
}

export function accessPage(viewer: Viewer, facts: AccessFacts): string {
  const choices = VPN_CHOICES.map(
    (choice) => html`<div class="choice${choice.usual === true ? ' pick' : ''}">
  ${choice.usual === true ? html`<span class="tag">Usual choice</span>` : undefined}
  <h3>${choice.title}</h3>
  <p>${choice.blurb}</p>
  <a class="action" href="/access/ovpn/${choice.variant}">Download profile</a>
</div>`,
  );
  return page(
    'My access',
    html`<h1>My access</h1>
<h2>Connect over VPN</h2>
<p class="muted">Download one profile and open it with your OpenVPN client.</p>
<div class="choices">${choices}</div>
<h2>Your details</h2>
<dl class="facts">
  <dt>Username</dt><dd>${facts.username}</dd>
  ${facts.sftpHost !== undefined
    ? html`<dt>SFTP host</dt><dd>${facts.sftpHost}</dd>`
    : undefined}
  <dt>Files</dt><dd>~/rtorrent/complete</dd>
  <dt>rtorrent port</dt><dd>${facts.rtorrentPort}</dd>
</dl>
<p class="muted">Your SFTP password is the one you use here.</p>
<p class="links"><a href="/rutorrent">Open ruTorrent</a> ·
<a href="/downloads">Downloads</a> ·
<a href="/password">Change password</a></p>`,
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
