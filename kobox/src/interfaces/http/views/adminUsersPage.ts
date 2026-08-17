import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
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
with a quota, and a VPN profile — and mails them a temporary password they are
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

export function adminUserDetailPage(
  user: SeedboxUser,
  viewer: Viewer,
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
