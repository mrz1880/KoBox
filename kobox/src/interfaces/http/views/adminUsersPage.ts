import type { TorrentInstance } from '../../../domain/torrent/TorrentInstance.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import type { DiskUsageSample } from '../../../domain/user/ports.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

function statusChip(user: SeedboxUser, viewer: Viewer): RawHtml {
  return user.status.isSuspended()
    ? html`<span class="chip bad">${viewer.t('suspended')}</span>`
    : html`<span class="chip ok">${viewer.t('active')}</span>`;
}

export function adminUsersPage(
  users: readonly SeedboxUser[],
  viewer: Viewer,
  message?: string,
): string {
  const rows = users.map(
    (user) => html`<tr>
  <td><a href="/admin/users/${user.username.value}">${user.username.value}</a></td>
  <td>${user.email.value}</td>
  <td>${user.accountType.value}</td>
  <td class="num">${user.quota.toGib()} GiB</td>
  <td class="num">${user.scgiPort.value}</td>
  <td>${statusChip(user, viewer)}</td>
</tr>`,
  );
  return page(
    'Users',
    html`<h1>${viewer.t('Users')}</h1>
<p class="muted">${viewer.t('members.intro')}</p>
<p class="muted">${viewer.t('members.suspend')}</p>
${flash(message)}
<table>
  <thead>
    <tr><th>${viewer.t('User')}</th><th>${viewer.t('Email')}</th><th>${viewer.t('Type')}</th><th>${viewer.t('Quota')}</th><th>${viewer.t('SCGI')}</th><th>${viewer.t('Status')}</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<h2>${viewer.t('Create user')}</h2>
<form class="card" method="post" action="/admin/users">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="username">Username</label>
  <input id="username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
  <label for="password">${viewer.t('Initial password')}</label>
  <input id="password" name="password" type="password" required minlength="8">
  <label for="quotaGib">${viewer.t('Quota (GiB)')}</label>
  <input id="quotaGib" name="quotaGib" type="number" min="1" value="412">
  <label for="accountType">${viewer.t('Account type')}</label>
  <select id="accountType" name="accountType">
    <option value="normal">normal</option>
    <option value="plex">plex</option>
  </select>
  <label for="role">${viewer.t('Portal role')}</label>
  <select id="role" name="role">
    <option value="user">user</option>
    <option value="admin">admin</option>
  </select>
  <button type="submit">${viewer.t('Create user')}</button>
</form>`,
    viewer,
  );
}

// The one per-member policy an admin can move. It is phrased as what the member
// will be able to do, not as the column name: "allow_public_tracker" tells you
// nothing about the consequence, and the consequence is the whole decision.
function publicTrackers(name: string, instance: TorrentInstance | undefined, viewer: Viewer): RawHtml {
  if (instance === undefined) {
    return html`<p class="muted">No rTorrent instance yet, so there is nothing to allow.</p>`;
  }
  const allowed = instance.allowPublicTracker;
  return html`<p>${name} can currently add torrents from
${allowed ? html`<strong>any tracker, public ones included</strong>` : html`<strong>private trackers only</strong>`}.</p>
<p class="muted">${viewer.t('trackers.public.why')}</p>
<form method="post" action="/admin/users/${name}/public-trackers">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label class="check"><input type="checkbox" name="allowed" ${allowed ? html`checked` : html``}>
  ${viewer.t('trackers.public.checkbox', { name })}</label>
  <button type="submit">${viewer.t('Save')}</button>
</form>`;
}

// Not the KoBox sync (that follows each folder's own mode) but the member's own
// shell scripts in ~/scripts, run after every finished download. Migrated
// members arrive with these off when none of their MySB folders synced, and
// until now nothing could turn them back on.
function finishScripts(name: string, instance: TorrentInstance | undefined, viewer: Viewer): RawHtml {
  if (instance === undefined) {
    return html`<p class="muted">No rTorrent instance yet, so nothing runs.</p>`;
  }
  const run = !instance.syncDisabled;
  return html`<p>Scripts in <span class="mono">/home/${name}/scripts</span> currently
${run ? html`<strong>run</strong>` : html`<strong>do not run</strong>`} when one of
${name}'s downloads finishes.</p>
<p class="muted">${viewer.t('scripts.theirs')}</p>
<form method="post" action="/admin/users/${name}/finish-scripts">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label class="check"><input type="checkbox" name="run" ${run ? html`checked` : html``}>
  ${viewer.t('scripts.checkbox', { name })}</label>
  <button type="submit">${viewer.t('Save')}</button>
</form>`;
}

// The allowance and what the disk actually holds. The reading is a sample the
// privileged worker wrote down, so it carries its own timestamp: a stale number
// presented as live is worse than no number.
function storage(user: SeedboxUser, usage: DiskUsageSample | undefined, viewer: Viewer): RawHtml {
  const name = user.username.value;
  const allowance = user.quota.toGib();
  const used =
    usage === undefined
      ? html`<p class="muted">Nothing measured yet. The hourly pass writes this down.</p>`
      : html`<p>${viewer.t('storage.using', { used: String(usage.used.toGib()), allowance: String(allowance) })}
(<span class="muted">${viewer.t('storage.measured', { at: usage.sampledAt })}</span>).</p>`;
  return html`${used}
<form method="post" action="/admin/users/${name}/quota">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="quotaGib">${viewer.t('Allowance (GiB)')}</label>
  <input id="quotaGib" name="quotaGib" type="number" min="1" value="${allowance}" required>
  <button type="submit">${viewer.t('Save')}</button>
</form>
<p class="muted">${viewer.t('quota.scope', { name })}</p>`;
}

// The three modes, said as consequences. "hardlink" is not a better "copy": it
// is the one that makes a quota stop measuring what a member actually holds, so
// it says that where the choice is made rather than in a manual.
function recycling(name: string, instance: TorrentInstance | undefined, viewer: Viewer): RawHtml {
  if (instance === undefined) {
    return html`<p class="muted">No rTorrent instance yet.</p>`;
  }
  const current = instance.recycling.value;
  const option = (value: string, label: string): RawHtml =>
    html`<option value="${value}" ${current === value ? html`selected` : html``}>${label}</option>`;
  return html`<p class="muted">${viewer.t('recycling.intro', { name })}</p>
<form method="post" action="/admin/users/${name}/recycling">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="mode">${viewer.t('What to do')}</label>
  <select id="mode" name="mode">
    ${option('none', 'Download it again (default)')}
    ${option('copy', 'Copy the files, so they get their own')}
    ${option('hardlink', 'Share the same files on disk')}
  </select>
  <button type="submit">${viewer.t('Save')}</button>
</form>
<p class="muted">${viewer.t('recycling.tradeoff')}</p>`;
}

export function adminUserDetailPage(
  user: SeedboxUser,
  viewer: Viewer,
  instance?: TorrentInstance,
  usage?: DiskUsageSample,
  message?: string,
): string {
  const name = user.username.value;
  const lifecycle = user.status.isSuspended()
    ? html`<form class="inline" method="post" action="/admin/users/${name}/resume">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">${viewer.t('Resume')}</button>
</form>`
    : html`<form class="inline" method="post" action="/admin/users/${name}/suspend">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">${viewer.t('Suspend')}</button>
</form>`;
  return page(
    `User ${name}`,
    html`<h1>${name} ${statusChip(user, viewer)}</h1>
${flash(message)}
<div class="card">
  <p>Email: ${user.email.value}<br>
  Type: ${user.accountType.value}<br>
  Quota: ${user.quota.toGib()} GiB<br>
  SCGI port: <span class="mono">${user.scgiPort.value}</span> ·
  rTorrent port: <span class="mono">${user.rtorrentPort.value}</span></p>
  ${lifecycle}
  <form class="inline" method="post" action="/admin/users/${name}/delete">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button type="submit" class="danger">${viewer.t('Delete (irreversible)')}</button>
  </form>
</div>

<h2>${viewer.t('Storage')}</h2>
<div class="card">${storage(user, usage, viewer)}</div>

<h2>${viewer.t('Nextcloud')}</h2>
<div class="card">
  <p class="muted">${viewer.t('nextcloud.what', { name })}</p>
  <p class="muted">${viewer.t('nextcloud.password')}</p>
  <form class="inline" method="post" action="/admin/users/${name}/nextcloud">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button type="submit">${viewer.t('Create their Nextcloud account')}</button>
  </form>
</div>

<h2>${viewer.t('Reusing what is already here')}</h2>
<div class="card">${recycling(name, instance, viewer)}</div>

<h2>${viewer.t('Public trackers')}</h2>
<div class="card">${publicTrackers(name, instance, viewer)}</div>

<h2>${viewer.t('Their own scripts')}</h2>
<div class="card">${finishScripts(name, instance, viewer)}</div>

<h2>${viewer.t('Reset password')}</h2>
<form class="card" method="post" action="/admin/users/${name}/password">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="password">${viewer.t('New password')}</label>
  <input id="password" name="password" type="password" required minlength="8">
  <button type="submit">${viewer.t('Reset password')}</button>
</form>`,
    viewer,
  );
}
