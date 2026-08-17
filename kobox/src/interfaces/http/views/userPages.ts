import type { DebridDownload } from '../../../domain/ddl/DebridDownload.js';
import type { MediaFile } from '../../../domain/media/MediaFile.js';
import type { Label } from '../../../domain/torrent/Label.js';
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

// What the person needs to know before anything else, said plainly. A VU meter
// belongs on the operator's console; someone who just wants their files needs a
// sentence telling them whether things are working and what to do if not.
function plainStatus(row: SignalRow): RawHtml {
  if (row.suspended) {
    return html`<p class="flash error">Your account is suspended. Contact the
    administrator to have it restored.</p>`;
  }
  if (!row.healthy) {
    return html`<p class="flash error">Your torrent client is not running.
    <a href="/rutorrent">Restart it from the ruTorrent page</a>.</p>`;
  }
  if (row.level === 'throttled') {
    return html`<p class="flash error">Your connection is temporarily slowed
    because of heavy use. It lifts on its own once traffic settles.</p>`;
  }
  if (row.level === 'alerted') {
    return html`<p class="flash">You are using a lot of bandwidth right now.
    Nothing is limited yet.</p>`;
  }
  return html`<p class="muted">Everything is running.</p>`;
}

interface HomeAction {
  readonly href: string;
  readonly title: string;
  readonly blurb: string;
}

// The three things people actually do here. ruTorrent comes first because that
// is where most of them spend their time — the portal is the place you visit to
// set something up or check on it, not where you live.
const HOME_ACTIONS: readonly HomeAction[] = [
  {
    href: '/rutorrent',
    title: 'Torrents',
    blurb: 'Add a torrent and follow it. This is the main tool.',
  },
  {
    href: '/media',
    title: 'My media',
    blurb: 'Watch or download what has finished.',
  },
  {
    href: '/downloads',
    title: 'Download a link',
    blurb: 'Paste a link from a file host and let the server fetch it.',
  },
];

export function userHomePage(
  user: SeedboxUser,
  viewer: Viewer,
  row: SignalRow,
  message?: string,
): string {
  const actions = HOME_ACTIONS.map(
    (action) => html`<div class="choice">
  <h3>${action.title}</h3>
  <p>${action.blurb}</p>
  <a class="action" href="${action.href}">Open</a>
</div>`,
  );
  return page(
    'Home',
    html`<h1>Hello ${user.username.value}</h1>
${flash(message)}
${plainStatus(row)}
<div class="choices">${actions}</div>
<p class="links"><a href="/access">My account and connection details</a></p>`,
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

// The member's own folders, the same list "Sending" shows. A closed films|series
// enum used to live here, so a member with a Divers folder could sync it and
// never download into it.
function folderChoice(folders: readonly Label[]): RawHtml {
  if (folders.length === 0) {
    return html`<p class="muted">You have no folders yet. Create one under
<a href="/sync">Sending</a> and it will show up here.</p>`;
  }
  const options = folders.map((folder) => html`<option value="${folder.value}">${folder.value}</option>`);
  return html`<select id="category" name="category">${options}</select>`;
}

// aria2 is what actually pulls the file down, and it skips its own install when
// no RPC secret is configured. Without this, every submitted link fails one at a
// time with a message about the last hop, and nothing says the engine is absent.
function engineNotice(engineReady: boolean): RawHtml {
  return engineReady
    ? html``
    : html`<p class="card bad">The download engine is <strong>not set up on this box</strong>,
so links will not go anywhere. This is not something you can fix from here:
tell an admin, and they will find the reason under Health.</p>`;
}

export function downloadsPage(
  viewer: Viewer,
  downloads: readonly DebridDownload[],
  hasKey: boolean,
  folders: readonly Label[],
  engineReady: boolean,
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
${engineNotice(engineReady)}
${debridAccountCard(viewer, hasKey)}
<form class="card" method="post" action="/downloads">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="link">Filehoster link</label>
  <input id="link" name="link" type="url" inputmode="url" placeholder="https://…" required>
  <label for="category">Folder</label>
  ${folderChoice(folders)}
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
  readonly hasAppToken: boolean;
  // set exactly once, on the response that issued it: only its hash is stored,
  // so no later page can show it again
  readonly freshToken?: string;
}

// What a member gives to Sonarr, Radarr or any other program that drives their
// torrents for them. Deliberately not their password: a download client's
// config file is a text file on another machine, and this one can be thrown
// away on its own.
function appTokenSection(viewer: Viewer, facts: AccessFacts): RawHtml {
  return html`<h2>Connect an app</h2>
<p class="muted">Sonarr, Radarr and friends can add torrents for you and follow
them. They sign in with your username and a <strong>token</strong> instead of
your password, so a program that leaks its settings costs you the token and not
your account. Throw it away here and it stops working immediately, everywhere.</p>
${facts.freshToken === undefined
    ? html``
    : html`<section class="panel">
  <p class="lead">Here is your token. Copy it now.</p>
  <p class="mono">${facts.freshToken}</p>
  <p class="muted">It will not be shown again. KoBox only keeps a fingerprint of
  it. If you lose it, make a new one; the old one stops working at that moment.</p>
</section>`}
<p class="muted">In the app, choose <span class="mono">rTorrent</span>, use your
own username, paste the token where it asks for a password, and point it at this
box on port 8189 with the path
<span class="mono">/ru/plugins/httprpc/action.php</span>. If you would rather not
connect anything, dropping a .torrent file into a folder's
<span class="mono">watch</span> directory works just as well.</p>
<form class="inline" method="post" action="/access/app-token">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">${facts.hasAppToken ? 'Make a new token' : 'Make a token'}</button>
</form>
${facts.hasAppToken
    ? html`<form class="inline" method="post" action="/access/app-token/revoke">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button class="ghost" type="submit">Throw it away</button>
</form>`
    : html``}`;
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

${appTokenSection(viewer, facts)}

<p class="links"><a href="/rutorrent">Open ruTorrent</a> ·
<a href="/downloads">Downloads</a> ·
<a href="/password">Change password</a></p>`,
    viewer,
  );
}

function formatSize(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) {
    return `${gib.toFixed(1)} GiB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MiB`;
}

// The end of the journey: what actually landed, ready to watch or take away.
// Grouped by the folder the file came down into, because that is how people
// think about it — not by the flat table the database happens to hold.
export function mediaPage(
  viewer: Viewer,
  files: readonly MediaFile[],
  message?: string,
): string {
  const groups = new Map<string, MediaFile[]>();
  for (const file of files) {
    const key = file.path.category === '' ? 'Loose files' : file.path.category;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([category, items]) => html`<h2>${category}</h2>
<table>
  <thead><tr><th>File</th><th>Size</th><th></th></tr></thead>
  <tbody>${items.map(
    (file) => html`<tr>
  <td class="path">${file.path.name}</td>
  <td class="num">${formatSize(file.sizeBytes)}</td>
  <td>${file.isBrowserPlayable
      ? html`<a href="/media/watch?path=${file.path.value}">Watch</a> ·
        <a href="/media/file?path=${file.path.value}" download>Download</a>`
      : html`<a href="/media/file?path=${file.path.value}" download>Download</a>`}</td>
</tr>`,
  )}</tbody>
</table>`,
    );
  return page(
    'My media',
    html`<h1>My media</h1>
${flash(message)}
${files.length === 0
      ? html`<p class="muted">Nothing here yet. Files appear once a download finishes.</p>`
      : html`${sections}`}`,
    viewer,
  );
}

// A player page rather than a bare file link: the browser keeps the session
// cookie, and seeking works because nginx serves the bytes with range support.
export function mediaWatchPage(viewer: Viewer, file: MediaFile): string {
  return page(
    'Watch',
    html`<h1>${file.path.name}</h1>
<video class="app" controls preload="metadata" src="/media/file?path=${file.path.value}"></video>
<p class="links"><a href="/media">Back to my media</a> ·
<a href="/media/file?path=${file.path.value}" download>Download this file</a></p>`,
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

// The nav offers this screen unconditionally, so it has to account for the
// backend not being there. Framing an iframe over nothing gives an admin an
// empty rectangle with a 404 inside it and no way to know why.
export function monitoringPage(viewer: Viewer, available: boolean): string {
  return page(
    'Monitoring',
    available
      ? html`<h1>Monitoring</h1>
<iframe class="app" src="/monitoring/" title="Monitoring"></iframe>`
      : html`<h1>Monitoring</h1>
<section class="panel">
  <p class="lead">No monitoring is installed on this box.</p>
  <p class="muted">KoBox vendors NanoMon from a pinned, checksum-verified
  release. Nothing is pinned, so the component skipped rather than fetching
  whatever a URL happened to serve. Set
  <span class="mono">KOBOX_NANOMON_URL</span> and
  <span class="mono">KOBOX_NANOMON_SHA256</span>, then run
  <span class="mono">kobox install</span>.</p>
  <p class="muted">Health tells you the same thing about every component, with
  the reason each one gave.</p>
</section>`,
    viewer,
  );
}
