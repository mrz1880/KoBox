import { Language } from '../../../domain/portal/Language.js';
import type { MediaFile } from '../../../domain/media/MediaFile.js';
import type { Label } from '../../../domain/torrent/Label.js';
import type { SshPublicKey } from '../../../domain/user/SshPublicKey.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import { BROWSER_CHOICE } from '../browserLanguage.js';
import { formatBytes } from './bytes.js';
import { icon } from './icons.js';
import type { MediaColumn, MediaOrder } from './mediaOrder.js';
import { memberSpace, type MeasuredSpace } from './space.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, sentence, type Reader, type Viewer } from './layout.js';
import type { Translate } from './messages.js';
import type { BlocklistCoverage } from '../../../domain/tracker/BlocklistCoverage.js';

function fairUseChip(level: string, t: Translate): RawHtml {
  if (level === 'throttled') {
    return html`<span class="chip bad">${t('throttled')}</span>`;
  }
  return level === 'alerted'
    ? html`<span class="chip warn">${t('alerted')}</span>`
    : html`<span class="chip ok">${t('within fair use')}</span>`;
}

// One member's channel on the console: what the portal can honestly know about
// them from the database alone. Their disk space travels apart, as the
// MeasuredSpace the hourly pass leaves behind.
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
  // looking at their own channel), and then no meter is drawn: the fair-use
  // verdict is carried by the LED and the level, which are authoritative.
  readonly scaleBytes?: number;
  readonly linked?: boolean;
  // shown instead of the username on a self view, where the page title already
  // names the person and repeating it says nothing
  readonly label?: string;
}

const VU_SEGMENTS = 24;

// The tone of the lit segments: the scale is the busiest channel, so position
// on it says nothing about fair use; the member's level does.
function vuTone(level: string): string {
  if (level === 'throttled') {
    return ' peak';
  }
  return level === 'alerted' ? ' warn' : '';
}

// Segments, not a smooth bar: the eye compares lengths across the desk long
// before it reads a figure.
function vuMeter(egressBytes: number, scaleBytes: number, level: string, reader: Reader): RawHtml {
  const { t } = reader;
  const ratio = scaleBytes > 0 ? egressBytes / scaleBytes : 0;
  const lit = Math.min(VU_SEGMENTS, Math.round(ratio * VU_SEGMENTS));
  const tone = vuTone(level);
  const segments = Array.from({ length: VU_SEGMENTS }, (_unused, index) =>
    index >= lit ? html`<i></i>` : html`<i class="on${tone}"></i>`,
  );
  return html`<div class="vu" role="img"
    aria-label="${t('Egress {egress}, busiest channel {busiest}', { egress: formatBytes(egressBytes, reader), busiest: formatBytes(scaleBytes, reader) })}">${segments}</div>`;
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

function stateWords(row: SignalRow, t: Translate): string {
  const service = t(row.suspended ? 'suspended' : row.healthy ? 'active' : 'service down');
  return row.level === 'none' ? service : `${service} · ${t(row.level)}`;
}

export function signalStrip(row: SignalRow, reader: Reader): RawHtml {
  const { t } = reader;
  const name =
    row.linked === true
      ? html`<a href="/admin/users/${row.username}">${row.username}</a>`
      : html`<span class="name">${row.label ?? row.username}</span>`;
  return html`<div class="strip">
  <span class="led ${ledClass(row)}"></span>
  <span class="who">${name}<span class="eyebrow">${stateWords(row, t)}</span></span>
  ${row.scaleBytes !== undefined && row.scaleBytes > 0
    ? vuMeter(row.egressBytes, row.scaleBytes, row.level, reader)
    : html`<span>${fairUseChip(row.level, t)}</span>`}
  <span class="figures">${sentence(t, '{sent} sent · {quota} GiB quota', {
    sent: html`<b>${formatBytes(row.egressBytes, reader)}</b>`,
    quota: html`${row.quotaGib}`,
  })}</span>
</div>`;
}

// What the person needs to know before anything else, said plainly. A VU meter
// belongs on the operator's console; someone who just wants their files needs a
// sentence telling them whether things are working and what to do if not.
function plainStatus(row: SignalRow, viewer: Viewer): RawHtml {
  if (row.suspended) {
    return html`<p class="flash error">${viewer.t('Your account is suspended. Contact the administrator to have it restored.')}</p>`;
  }
  if (!row.healthy) {
    return html`<p class="flash error">${sentence(viewer.t, 'Your torrent client is not running. {restart}.', {
      restart: html`<a href="/rutorrent">${viewer.t('Restart it from the ruTorrent page')}</a>`,
    })}</p>`;
  }
  if (row.level === 'throttled') {
    return html`<p class="flash error">${viewer.t('Your connection is temporarily slowed because of heavy use. It lifts on its own once traffic settles.')}</p>`;
  }
  if (row.level === 'alerted') {
    return html`<p class="flash">${viewer.t('You are using a lot of bandwidth right now. Nothing is limited yet.')}</p>`;
  }
  return html`<p class="muted">${viewer.t('Everything is running.')}</p>`;
}

interface HomeAction {
  readonly href: string;
  readonly title: string;
  readonly blurb: string;
}

// The two things people actually do here. ruTorrent comes first because that
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
];

export function userHomePage(
  user: SeedboxUser,
  viewer: Viewer,
  row: SignalRow,
  space: MeasuredSpace | undefined,
  now: string,
  message?: string,
): string {
  const actions = HOME_ACTIONS.map(
    (action) => html`<div class="choice">
  <h3>${viewer.t(action.title)}</h3>
  <p>${viewer.t(action.blurb)}</p>
  <a class="action" href="${action.href}">${viewer.t('Open')}</a>
</div>`,
  );
  return page(
    'Home',
    html`<h1>${viewer.t('Hello {name}', { name: user.username.value })}</h1>
${flash(viewer.t, message)}
${plainStatus(row, viewer)}
${memberSpace(space, viewer, now)}
<div class="choices">${actions}</div>
<p class="links"><a href="/access">${viewer.t('My account and connection details')}</a></p>`,
    viewer,
  );
}

export type FleetRow = SignalRow;

// The fleet console: an aggregate ribbon, then one channel per user. The strips
// are ordered loudest-first, so whoever is pushing the most egress is at the top
// of the desk rather than buried in alphabetical order.
// Only the two states that leave the box unprotected get a word, each with
// the one click that fixes it.
function blocklistWarning(coverage: BlocklistCoverage, viewer: Viewer): RawHtml {
  switch (coverage) {
    case 'blocking':
      return html``;
    case 'no-list-enabled':
      return html`<section class="panel">
  <p class="lead">${viewer.t('Nothing is blocked: no blocklist is enabled.')}</p>
  <p class="muted">${viewer.t('Importing the catalog enables the lists MySB used, and downloads them.')}</p>
  <form class="inline" method="post" action="/admin/blocklists/import-catalog">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button type="submit">${viewer.t('Import the catalog')}</button>
  </form>
</section>`;
    case 'not-downloaded-yet':
      return html`<section class="panel">
  <p class="lead">${viewer.t('Nothing is blocked yet: the enabled blocklists were never downloaded.')}</p>
  <form class="inline" method="post" action="/admin/blocklists/update">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button type="submit">${viewer.t('Download them now')}</button>
  </form>
</section>`;
  }
}

export function adminHomePage(
  rows: readonly FleetRow[],
  coverage: BlocklistCoverage,
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
    html`<h1>${viewer.t('Overview')}</h1>
${flash(viewer.t, message)}
${blocklistWarning(coverage, viewer)}
<div class="ribbon">
  <span class="metric"><span class="eyebrow">${viewer.t('Users active')}</span>
    <span class="val">${active}/${rows.length}</span></span>
  <span class="metric"><span class="eyebrow">${viewer.t('Egress this window')}</span>
    <span class="val">${formatBytes(totalEgress, viewer)}</span></span>
  <span class="metric"><span class="eyebrow">${viewer.t('Over fair use')}</span>
    <span class="val${flagged > 0 ? ' alert' : ''}">${flagged}</span></span>
  <span class="metric"><span class="eyebrow">${viewer.t('Service down')}</span>
    <span class="val${down > 0 ? ' bad' : ''}">${down}</span></span>
</div>
<h2>${viewer.t('Channels')}</h2>
<p class="muted">${viewer.t('Meters run full scale at the busiest channel ({scale}). Loudest first.', { scale: formatBytes(scaleBytes, viewer) })}</p>
${loudestFirst.map((row) => signalStrip({ ...row, scaleBytes, linked: true }, viewer))}
<p class="links"><a href="/admin/users">${viewer.t('Manage users')}</a> ·
<a href="/admin/fair-use">${viewer.t('Fair use')}</a> ·
<a href="/admin/health">${viewer.t('Health')}</a></p>`,
    viewer,
    'admin',
  );
}

export function passwordPage(viewer: Viewer, error?: string, ok?: string): string {
  return page(
    'Password',
    html`<h1>${viewer.t('Change password')}</h1>
${flash(viewer.t, ok)}
${flash(viewer.t, error, 'error')}
<form class="card" method="post" action="/password">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="current">${viewer.t('Current password')}</label>
  <input id="current" name="current" type="password" autocomplete="current-password" required>
  <label for="next">${viewer.t('New password')}</label>
  <input id="next" name="next" type="password" autocomplete="new-password" required minlength="8">
  <button type="submit">${viewer.t('Change password')}</button>
</form>`,
    viewer,
  );
}

// What a person actually came here to do: get connected. That means choosing a
// profile — so the three variants are presented as a choice, each carrying the
// sentence that tells you whether it is yours — and then knowing their own
// connection details, which the page previously never showed at all.
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

// A dynamic name a member declared, and the address it pointed at when the box
// last looked it up (none yet right after it was added).
export interface MemberHostname {
  readonly host: string;
  readonly pointsAt?: string;
}

export interface AccessFacts {
  readonly username: string;
  readonly sftpHost?: string;
  readonly sshPort: number;
  readonly rtorrentPort: number;
  readonly hasAppToken: boolean;
  // set exactly once, on the response that issued it: only its hash is stored,
  // so no later page can show it again
  readonly freshToken?: string;
  readonly sshKey?: SshPublicKey;
  readonly sshKeyAddedAt?: string;
  // the member's own declared addresses only: nobody sees anyone else's
  readonly addresses: readonly string[];
  readonly hostnames: readonly MemberHostname[];
  readonly hasTwoStep: boolean;
  // where this request came from; absent over IPv6, which cannot be declared
  readonly currentAddress?: string;
  // absent while the member lets their browser decide
  readonly chosenLanguage?: Language;
}

function twoStepSection(viewer: Viewer, facts: AccessFacts): RawHtml {
  return html`<h2 id="two-step">${viewer.t('Two-step sign-in')}</h2>
<p class="muted">${viewer.t('After your password, a 6-digit code from an app on your phone (Aegis, Google Authenticator, 1Password...). Someone who learns your password still cannot sign in. Administrators need it to open Administration.')}</p>
${facts.hasTwoStep
    ? html`<p><span class="chip ok">${viewer.t('On')}</span></p>
<form class="card" method="post" action="/access/two-step/stop">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="stop-code">${viewer.t('Current code from your app')}</label>
  <input id="stop-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
  <button type="submit" class="ghost">${viewer.t('Turn it off')}</button>
</form>`
    : html`<form class="inline" method="post" action="/access/two-step/start">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">${viewer.t('Set it up')}</button>
</form>`}`;
}

// The secret is shown on this one response and never again: the member adds
// it to their app, then proves it with a first code.
export function twoStepSetupPage(viewer: Viewer, username: string, secret: string): string {
  const uri = `otpauth://totp/KoBox:${username}?secret=${secret}&issuer=KoBox`;
  return page(
    'Two-step sign-in',
    html`<h1>${viewer.t('Two-step sign-in')}</h1>
<section class="panel">
  <p class="lead">${viewer.t('Add this key to your authenticator app.')}</p>
  <p class="mono">${secret.replace(/(.{4})/g, '$1 ').trim()}</p>
  <p class="muted">${sentence(viewer.t, 'On the phone that has the app, this link adds it directly: {link}', {
    link: html`<a href="${uri}">${uri}</a>`,
  })}</p>
</section>
<form class="card" method="post" action="/access/two-step/confirm">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="code">${viewer.t('Then type the code the app shows')}</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
    pattern="[0-9]{6}" maxlength="6" autofocus required>
  <button type="submit">${viewer.t('Turn it on')}</button>
</form>
<p class="links"><a href="/access">${viewer.t('Not now')}</a></p>`,
    viewer,
  );
}

// SSH and SFTP answer only declared addresses and the VPN, so a member whose
// home address changed fixes it from here, on the web, which stays open.
function addressesSection(viewer: Viewer, facts: AccessFacts): RawHtml {
  const declaredHere =
    facts.currentAddress !== undefined && facts.addresses.includes(facts.currentAddress);
  return html`<h2>${viewer.t('Where you connect from')}</h2>
<p class="muted">${viewer.t('SSH and SFTP accept connections from the addresses below and from the VPN. Add your address from home, from the place your scripts or your NAS run. Only you and the administrators see this list.')}</p>
${facts.addresses.length === 0
    ? html`<p class="muted">${viewer.t('No address declared.')}</p>`
    : html`<ul>${facts.addresses.map(
      (address) => html`<li><span class="mono">${address}</span>
<form class="inline" method="post" action="/access/addresses/remove">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <input type="hidden" name="ipv4" value="${address}">
  <button type="submit" class="ghost">${viewer.t('Remove')}</button>
</form></li>`,
    )}</ul>`}
${facts.currentAddress === undefined
    ? html`<p class="muted">${viewer.t('You are connecting over IPv6 right now. Only IPv4 addresses can be declared: come back from a connection that uses IPv4.')}</p>`
    : declaredHere
      ? html`<p>${sentence(viewer.t, 'You are connecting from {address}, which is declared.', {
        address: html`<span class="mono">${facts.currentAddress}</span>`,
      })}</p>`
      : html`<form class="inline" method="post" action="/access/addresses/add-current">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <span>${sentence(viewer.t, 'You are connecting from {address}.', {
    address: html`<span class="mono">${facts.currentAddress}</span>`,
  })}</span>
  <button type="submit">${viewer.t('Add this address')}</button>
</form>`}
<form class="card" method="post" action="/access/addresses/add">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="ipv4">${viewer.t('Another place')}</label>
  <input id="ipv4" name="ipv4" required inputmode="decimal" placeholder="203.0.113.20">
  <p class="muted">${viewer.t('For a place you are not at right now, your NAS at home or the office: type the public address it shows to the internet (a site like whatismyip.com, opened from there, tells you).')}</p>
  <button type="submit">${viewer.t('Add')}</button>
</form>
${hostnamesPart(viewer, facts)}`;
}

// A home address that changes on its own is declared by a name the member's
// router or a dynamic DNS service (DuckDNS, No-IP...) keeps up to date.
function hostnamesPart(viewer: Viewer, facts: AccessFacts): RawHtml {
  return html`<h3>${viewer.t('Dynamic hostname')}</h3>
<p class="muted">${viewer.t('If your home address changes on its own, give a name your router or a service like DuckDNS keeps pointed at it. The box looks it up every five minutes and follows it.')}</p>
${facts.hostnames.length === 0
    ? html``
    : html`<ul>${facts.hostnames.map(
      (hostname) => html`<li><span class="mono">${hostname.host}</span>
<span class="muted">${hostname.pointsAt === undefined
        ? viewer.t('not looked up yet')
        : sentence(viewer.t, 'points at {address}', {
          address: html`<span class="mono">${hostname.pointsAt}</span>`,
        })}</span>
<form class="inline" method="post" action="/access/hostnames/remove">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <input type="hidden" name="hostname" value="${hostname.host}">
  <button type="submit" class="ghost">${viewer.t('Remove')}</button>
</form></li>`,
    )}</ul>`}
<form class="card" method="post" action="/access/hostnames/add">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="hostname">${viewer.t('Hostname')}</label>
  <input id="hostname" name="hostname" required placeholder="myhome.duckdns.org">
  <button type="submit">${viewer.t('Add')}</button>
</form>`;
}

// A key is for a script on the member's own machine dropping torrent files in.
// It is deliberately not a way in to a shell: KoBox writes the entry with
// `restrict` and a forced internal-sftp command, so the key transfers files and
// does nothing else. Saying that here is the difference between a member
// understanding the limit and reporting it as a bug.
function sshKeySection(viewer: Viewer, facts: AccessFacts): RawHtml {
  return html`<h2>${viewer.t('Your own SSH key')}</h2>
${facts.sshKey === undefined
    ? html`<p class="muted">${viewer.t('No key installed. Add your public key and a script on your own machine can drop torrent files straight into your folders, without a password.')}</p>`
    : html`<p>${sentence(viewer.t, 'Installed: {key}', {
      key: html`<span class="mono">${facts.sshKey.type}</span>
${facts.sshKey.comment === '' ? html`` : html`<span class="mono">${facts.sshKey.comment}</span>`}`,
    })}
<span class="muted">${viewer.t('since {date}', { date: facts.sshKeyAddedAt ?? '' })}</span></p>
<form class="inline" method="post" action="/access/ssh-key/remove">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit" class="danger">${viewer.t('Remove it')}</button>
</form>`}
<form class="card" method="post" action="/access/ssh-key">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="sshkey">${viewer.t('Public key')}</label>
  <input id="sshkey" name="key" required placeholder="ssh-ed25519 AAAA... you@yourmachine">
  <p class="muted">${sentence(viewer.t, 'The {public} half, the one line from {file}. Never paste a private key here or anywhere else. This key transfers files and cannot open a shell, which is all a send-my-torrents script needs.', {
    public: html`<strong>${viewer.t('public')}</strong>`,
    file: html`<span class="mono">~/.ssh/id_ed25519.pub</span>`,
  })}</p>
  <button type="submit">${viewer.t('Install this key')}</button>
</form>
${facts.sftpHost === undefined
    ? html``
    : html`<p class="muted">${viewer.t("With the key installed, send a torrent file over SFTP into one of your folders (replace FOLDER with its name, as listed under Folders); rTorrent picks it up within a few seconds and gives it that folder's label:")}</p>
<p class="mono">scp -P ${facts.sshPort} my.torrent ${facts.username}@${facts.sftpHost}:rtorrent/watch/FOLDER/</p>`}`;
}

// What a member gives to Sonarr, Radarr or any other program that drives their
// torrents for them. Deliberately not their password: a download client's
// config file is a text file on another machine, and this one can be thrown
// away on its own.
function appTokenSection(viewer: Viewer, facts: AccessFacts): RawHtml {
  return html`<h2>${viewer.t('Connect an app')}</h2>
<p class="muted">${sentence(viewer.t, 'Sonarr, Radarr and friends can add torrents for you and follow them. They sign in with your username and a {token} instead of your password, so a program that leaks its settings costs you the token and not your account. Throw it away here and it stops working immediately, everywhere.', {
  token: html`<strong>${viewer.t('token')}</strong>`,
})}</p>
${facts.freshToken === undefined
    ? html``
    : html`<section class="panel">
  <p class="lead">${viewer.t('Here is your token. Copy it now.')}</p>
  <p class="mono">${facts.freshToken}</p>
  <p class="muted">${viewer.t('It will not be shown again. KoBox only keeps a fingerprint of it. If you lose it, make a new one; the old one stops working at that moment.')}</p>
</section>`}
<p class="muted">${sentence(viewer.t, "In the app, choose {client}, use your own username, paste the token where it asks for a password, and point it at this box on port {port} with the path {path}. If you would rather not connect anything, dropping a .torrent file into a folder's {watch} directory works just as well.", {
  client: html`<span class="mono">rTorrent</span>`,
  port: html`8189`,
  path: html`<span class="mono">/ru/plugins/httprpc/action.php</span>`,
  watch: html`<span class="mono">watch</span>`,
})}</p>
<form class="inline" method="post" action="/access/app-token">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">${viewer.t(facts.hasAppToken ? 'Make a new token' : 'Make a token')}</button>
</form>
${facts.hasAppToken
    ? html`<form class="inline" method="post" action="/access/app-token/revoke">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button class="ghost" type="submit">${viewer.t('Throw it away')}</button>
</form>`
    : html``}`;
}

export interface FileAccessFacts {
  readonly username: string;
  readonly nextcloudInstalled: boolean;
  readonly nextcloudHref: string;
  readonly sftpHost: string;
  // the box's own address in the usual tunnel, where the network share lives
  readonly boxInVpn: string;
}

// Nextcloud is the simplest way, and is offered as such only once installed:
// missing, it moves last with a word on why.
function nextcloudChoice(viewer: Viewer, facts: FileAccessFacts): RawHtml {
  if (!facts.nextcloudInstalled) {
    return html`<div class="choice">
  <h3>Nextcloud</h3>
  <p>${viewer.t('Nextcloud is not installed on this box. Ask an administrator.')}</p>
</div>`;
  }
  return html`<div class="choice pick">
  <span class="tag">${viewer.t('Simplest')}</span>
  <h3>Nextcloud</h3>
  <p>${viewer.t('In the browser, or in the Nextcloud app on a phone or a computer. No VPN, nothing to set up on your network.')}</p>
  <a class="action" href="${facts.nextcloudHref}">${viewer.t('Open Nextcloud')}</a>
</div>`;
}

// Every way to reach one's files, simplest first, all with the portal login.
export function filesPage(viewer: Viewer, facts: FileAccessFacts): string {
  const nextcloud = nextcloudChoice(viewer, facts);
  return page(
    'My files',
    html`<h1>${viewer.t('My files')}</h1>
<p class="lead">${sentence(viewer.t, 'Three ways to reach your files. All of them take your username, {username}, and the password you use here.', {
  username: html`<span class="mono">${facts.username}</span>`,
})}</p>
<div class="choices">
${facts.nextcloudInstalled ? nextcloud : html``}
<div class="choice">
  <h3>SFTP</h3>
  <p>${viewer.t('For FileZilla, Cyberduck or rsync, and for large transfers.')}</p>
  <p class="mono">sftp://${facts.username}@${facts.sftpHost}</p>
</div>
<div class="choice">
  <h3>${viewer.t('Network share')}</h3>
  <p>${sentence(viewer.t, 'Samba, like a local disk. Connect the VPN with the usual profile first ({account}), then open:', {
    account: html`<a href="/access">${viewer.t('Account')}</a>`,
  })}</p>
  <p class="mono">smb://${facts.boxInVpn}/${facts.username}</p>
</div>
${facts.nextcloudInstalled ? html`` : nextcloud}
</div>`,
    viewer,
  );
}

// Each language is offered in its own name, so a member who cannot read the
// page they landed on still finds theirs.
function languageSection(viewer: Viewer, facts: AccessFacts): RawHtml {
  const options: readonly (readonly [string, string])[] = [
    [BROWSER_CHOICE, 'Same as my browser'],
    [Language.fr.value, 'French (Français)'],
    [Language.en.value, 'English'],
  ];
  const current = facts.chosenLanguage?.value ?? BROWSER_CHOICE;
  const ticked = (value: string): RawHtml => (value === current ? html`checked` : html``);
  return html`<h2>${viewer.t('Language')}</h2>
<form class="card" method="post" action="/access/language">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  ${options.map(
    ([value, label]) => html`<label class="check">
    <input type="radio" name="language" value="${value}" ${ticked(value)}>
    ${viewer.t(label)}</label>`,
  )}
  <button type="submit">${viewer.t('Save language')}</button>
</form>`;
}

export function accessPage(viewer: Viewer, facts: AccessFacts, message?: string): string {
  const choices = VPN_CHOICES.map(
    (choice) => html`<div class="choice${choice.usual === true ? ' pick' : ''}">
  ${choice.usual === true ? html`<span class="tag">${viewer.t('Usual choice')}</span>` : undefined}
  <h3>${viewer.t(choice.title)}</h3>
  <p>${viewer.t(choice.blurb)}</p>
  <a class="action" href="/access/ovpn/${choice.variant}">${viewer.t('Download profile')}</a>
</div>`,
  );
  return page(
    'Account',
    html`<h1>${viewer.t('Account')}</h1>
${flash(viewer.t, message)}
<h2>${viewer.t('Connect over VPN')}</h2>
<p class="muted">${viewer.t('Download one profile and open it with your OpenVPN client.')}</p>
<div class="choices">${choices}</div>
<h2>${viewer.t('Your details')}</h2>
<dl class="facts">
  <dt>${viewer.t('Username')}</dt><dd>${facts.username}</dd>
  ${facts.sftpHost !== undefined
    ? html`<dt>${viewer.t('SFTP host')}</dt><dd>${facts.sftpHost}</dd>`
    : undefined}
  <dt>${viewer.t('Files')}</dt><dd>~/rtorrent/complete</dd>
  <dt>${viewer.t('rTorrent port')}</dt><dd>${facts.rtorrentPort}</dd>
</dl>
<p class="muted">${viewer.t('Your SFTP password is the one you use here.')}</p>

${appTokenSection(viewer, facts)}

${twoStepSection(viewer, facts)}

${addressesSection(viewer, facts)}

${sshKeySection(viewer, facts)}

${languageSection(viewer, facts)}

<p class="links"><a href="/rutorrent">${viewer.t('Open ruTorrent')}</a> ·
<a href="/password">${viewer.t('Change password')}</a></p>`,
    viewer,
  );
}

// Beside each video, so nobody wonders why one has no player: nothing is
// re-encoded, and most releases come in a container browsers do not open. The
// slot stays even when empty, so the download icons line up.
function playSlot(file: MediaFile, viewer: Viewer): RawHtml {
  switch (file.playback) {
    case 'in-browser': {
      const label = viewer.t('Watch in the browser');
      return html`<a class="icon-action" href="/media/watch?path=${file.path.value}" aria-label="${label}" title="${label}">${icon('play')}</a>`;
    }
    case 'download-only': {
      const why = viewer.t('{container}: browsers do not play it. Download it to watch it.', {
        container: file.extension.toUpperCase(),
      });
      return html`<span class="icon-action muted" role="img" aria-label="${why}" title="${why}">${icon('tv-off')}</span>`;
    }
    case 'not-a-video':
      return html`<span class="icon-action"></span>`;
  }
}

function downloadLink(file: MediaFile, viewer: Viewer): RawHtml {
  const label = viewer.t('Download');
  return html`<a class="icon-action" href="/media/file?path=${file.path.value}" download aria-label="${label}" title="${label}">${icon('download')}</a>`;
}

const READ_AS: Record<MediaOrder['direction'], string> = { asc: 'ascending', desc: 'descending' };
const ARROW: Record<MediaOrder['direction'], string> = { asc: '▲', desc: '▼' };

// A header that sorts the list: a plain link, so it works without a script,
// and aria-sort tells a screen reader which column the list follows.
function sortHeader(label: string, column: MediaColumn, order: MediaOrder, viewer: Viewer): RawHtml {
  const active = order.column === column;
  return html`<th${active ? html` aria-sort="${READ_AS[order.direction]}"` : ''}><a class="sort" href="/media?${order.linkFor(column)}">${viewer.t(label)}${active ? html` <span aria-hidden="true">${ARROW[order.direction]}</span>` : ''}</a></th>`;
}

// The end of the journey: what actually landed, ready to watch or take away.
// Grouped by the folder the file came down into, because that is how people
// think about it, not by the flat table the database happens to hold.
export function mediaPage(
  viewer: Viewer,
  files: readonly MediaFile[],
  folders: readonly Label[],
  order: MediaOrder,
  message?: string,
): string {
  // A folder exists before its contents do. Seeding the groups from the
  // member's own folders means an empty seedbox looks empty rather than broken,
  // and the shape stays the same whether or not anything has landed.
  const groups = new Map<string, MediaFile[]>();
  for (const folder of folders) {
    groups.set(folder.value, []);
  }
  for (const file of files) {
    const key = file.path.category === '' ? viewer.t('Loose files') : file.path.category;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([category, items]) =>
        items.length === 0
          ? html`<h2>${category}</h2>
<p class="muted">${viewer.t('Empty for now.')}</p>`
          : html`<h2>${category}</h2>
<table>
  <thead><tr>${sortHeader('File', 'name', order, viewer)}${sortHeader('Size', 'size', order, viewer)}<th class="act"></th></tr></thead>
  <tbody>${order.sorted(items).map(
    (file) => html`<tr>
  <td class="path">${file.path.name}</td>
  <td class="num">${formatBytes(file.sizeBytes, viewer)}</td>
  <td class="act">${playSlot(file, viewer)}${downloadLink(file, viewer)}</td>
</tr>`,
  )}</tbody>
</table>`,
    );
  return page(
    'My media',
    html`<h1>${viewer.t('My media')}</h1>
${flash(viewer.t, message)}
<p class="lead">${viewer.t('media.playback')}</p>
${sections.length === 0
      ? html`<p class="muted">${sentence(viewer.t, 'You have no folders yet. Create one under {folders}, and what lands in it shows up here.', {
        folders: html`<a href="/sync">${viewer.t('Folders')}</a>`,
      })}</p>`
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
<p class="links"><a href="/media">${viewer.t('Back to my media')}</a> ·
<a href="/media/file?path=${file.path.value}" download>${viewer.t('Download this file')}</a></p>`,
    viewer,
  );
}

export function rutorrentPage(viewer: Viewer, message?: string): string {
  return page(
    'ruTorrent',
    html`<h1>ruTorrent</h1>
${flash(viewer.t, message)}
<form class="inline" method="post" action="/rutorrent/restart">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button class="ghost" type="submit">${viewer.t('Restart my rTorrent')}</button>
  <span class="muted">${viewer.t('Use this if the interface stops responding.')}</span>
</form>
<p class="links"><a href="/ru/" target="_blank" rel="noopener">${viewer.t('Full screen')}</a></p>
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
      ? html`<h1>${viewer.t('Monitoring')}</h1>
<iframe class="app" src="/monitoring/" title="Monitoring"></iframe>`
      : html`<h1>${viewer.t('Monitoring')}</h1>
<section class="panel">
  <p class="lead">${viewer.t('No monitoring is installed on this box.')}</p>
  <p class="muted">${sentence(viewer.t, 'KoBox vendors NanoMon from a pinned, checksum-verified release. Nothing is pinned, so the component skipped rather than fetching whatever a URL happened to serve. Set {url} and {checksum}, then run {install}.', {
    url: html`<span class="mono">KOBOX_NANOMON_URL</span>`,
    checksum: html`<span class="mono">KOBOX_NANOMON_SHA256</span>`,
    install: html`<span class="mono">kobox install</span>`,
  })}</p>
  <p class="muted">${viewer.t('Health tells you the same thing about every component, with the reason each one gave.')}</p>
</section>`,
    viewer,
    'admin',
  );
}
