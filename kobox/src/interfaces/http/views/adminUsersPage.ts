import type { TorrentInstance } from '../../../domain/torrent/TorrentInstance.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import type { DiskUsageSample } from '../../../domain/user/ports.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

function statusChip(user: SeedboxUser): RawHtml {
  return user.status.isSuspended()
    ? html`<span class="chip bad">suspended</span>`
    : html`<span class="chip ok">active</span>`;
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
  <td>${statusChip(user)}</td>
</tr>`,
  );
  return page(
    'Users',
    html`<h1>Users</h1>
<p class="muted">Everyone with an account on the box. Creating one provisions a
real system account, its own rTorrent instance on its own port, a home directory
with a quota, and a VPN profile, then mails them a temporary password they are
forced to change on first sign-in. <strong>SCGI</strong> is the port their
ruTorrent talks to; it is shown because it is what you need when something is
wrong, and it is preserved if they are ever migrated.</p>
<p class="muted">Suspending is reversible and cuts access without touching a
single file: their transfers stop, their data stays. Deleting is not reversible.</p>
${flash(message)}
<table>
  <thead>
    <tr><th>User</th><th>Email</th><th>Type</th><th>Quota</th><th>SCGI</th><th>Status</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<h2>Create user</h2>
<form class="card" method="post" action="/admin/users">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="username">Username</label>
  <input id="username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
  <label for="password">Initial password</label>
  <input id="password" name="password" type="password" required minlength="8">
  <label for="quotaGib">Quota (GiB)</label>
  <input id="quotaGib" name="quotaGib" type="number" min="1" value="412">
  <label for="accountType">Account type</label>
  <select id="accountType" name="accountType">
    <option value="normal">normal</option>
    <option value="plex">plex</option>
  </select>
  <label for="role">Portal role</label>
  <select id="role" name="role">
    <option value="user">user</option>
    <option value="admin">admin</option>
  </select>
  <button type="submit">Create user</button>
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
<p class="muted">Public trackers are watched by anti-piracy monitors, which is why this
stays off unless someone asks for it. Torrents already added are not touched.</p>
<form method="post" action="/admin/users/${name}/public-trackers">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label class="check"><input type="checkbox" name="allowed" ${allowed ? html`checked` : html``}>
  Let ${name} add torrents from public trackers</label>
  <button type="submit">Save</button>
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
<p class="muted">These are their own scripts, not KoBox's: each folder's sync
follows its own setting and is unaffected by this.</p>
<form method="post" action="/admin/users/${name}/finish-scripts">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label class="check"><input type="checkbox" name="run" ${run ? html`checked` : html``}>
  Run ${name}'s own scripts after a finished download</label>
  <button type="submit">Save</button>
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
      : html`<p>Using <strong>${usage.used.toGib()} GiB</strong> of ${allowance} GiB
(<span class="muted">measured ${usage.sampledAt}</span>).</p>`;
  return html`${used}
<form method="post" action="/admin/users/${name}/quota">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="quotaGib">Allowance (GiB)</label>
  <input id="quotaGib" name="quotaGib" type="number" min="1" value="${allowance}" required>
  <button type="submit">Save</button>
</form>
<p class="muted">Changing this affects ${name} and nobody else. Lowering it below
what they already store does not delete anything; it stops them writing more.</p>`;
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
  <button type="submit">Resume</button>
</form>`
    : html`<form class="inline" method="post" action="/admin/users/${name}/suspend">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">Suspend</button>
</form>`;
  return page(
    `User ${name}`,
    html`<h1>${name} ${statusChip(user)}</h1>
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
    <button type="submit" class="danger">Delete (irreversible)</button>
  </form>
</div>

<h2>Storage</h2>
<div class="card">${storage(user, usage, viewer)}</div>

<h2>Public trackers</h2>
<div class="card">${publicTrackers(name, instance, viewer)}</div>

<h2>Their own scripts</h2>
<div class="card">${finishScripts(name, instance, viewer)}</div>

<h2>Reset password</h2>
<form class="card" method="post" action="/admin/users/${name}/password">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="password">New password</label>
  <input id="password" name="password" type="password" required minlength="8">
  <button type="submit">Reset password</button>
</form>`,
    viewer,
  );
}
