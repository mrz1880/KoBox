import { ROLES, type Role } from '../../../domain/portal/Role.js';
import type { TorrentInstance } from '../../../domain/torrent/TorrentInstance.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import type { DiskUsageSample, VolumeSample } from '../../../domain/user/ports.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, sentence, type Viewer } from './layout.js';
import { HOME_BASE } from '../../../domain/user/homeDirectory.js';
import { Quota } from '../../../domain/user/Quota.js';
import type { SpaceLimit } from '../../../domain/user/UsableSpace.js';
import { formatBytes } from './bytes.js';
import { leftToFill, measuredSpace, type MeasuredSpace } from './space.js';

function roleOptions(selected: Role): RawHtml[] {
  return ROLES.map(
    (role) => html`<option value="${role}"${role === selected ? html` selected` : html``}>${role}</option>`,
  );
}

function statusChip(user: SeedboxUser, viewer: Viewer): RawHtml {
  return user.status.isSuspended()
    ? html`<span class="chip bad">${viewer.t('suspended')}</span>`
    : html`<span class="chip ok">${viewer.t('active')}</span>`;
}

// someone who has not chosen a password yet: their link is what lets them in
function invitationChip(name: string, viewer: Viewer): RawHtml {
  return html`<span class="chip warn">${viewer.t('invited')}</span>
<form class="inline" method="post" action="/admin/users/${name}/password-link">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button class="ghost" type="submit">${viewer.t('Send the link again')}</button>
</form>`;
}

// What the list shows of a member's portal login. A member without one (an
// account made outside the portal) has no entry at all.
export interface MemberLogin {
  readonly role: Role;
  // has not followed their invitation yet
  readonly invited: boolean;
}

const ROLE_LABELS: Record<Role, string> = { admin: 'Administrator', user: 'Member' };

// What the hourly pass last measured: each member's usage, by username, and
// the volume they all share.
export interface DiskReadings {
  readonly usages: ReadonlyMap<string, DiskUsageSample>;
  readonly volume: VolumeSample | undefined;
}

function usedCell(usage: DiskUsageSample | undefined, viewer: Viewer): RawHtml {
  return usage === undefined
    ? html`<td class="num"><span class="muted">${viewer.t('not measured')}</span></td>`
    : html`<td class="num">${formatBytes(usage.used.toBytes(), viewer.t)}</td>`;
}

function freeCell(space: MeasuredSpace | undefined, viewer: Viewer): RawHtml {
  return space === undefined
    ? html`<td class="num"><span class="muted">${viewer.t('not measured')}</span></td>`
    : html`<td class="num">${formatBytes(space.usable.free.toBytes(), viewer.t)}${diskMark(space.usable.limit, viewer)}</td>`;
}

// The box as a whole: the disk beside what every member was promised, so an
// overcommitted box shows at a glance.
function boxDisk(
  users: readonly SeedboxUser[],
  volume: VolumeSample | undefined,
  viewer: Viewer,
): RawHtml {
  const allowances = viewer.t('Allowances add up to {allowances}.', {
    allowances: formatBytes(Quota.total(users.map((user) => user.quota)).toBytes(), viewer.t),
  });
  return html`<p>${volume === undefined
    ? viewer.t('Disk not measured yet.')
    : viewer.t('Disk: {free} free of {size}.', {
        free: formatBytes(volume.space.free.toBytes(), viewer.t),
        size: formatBytes(volume.space.size.toBytes(), viewer.t),
      })} ${allowances}</p>`;
}

// the disk, not the allowance, is what stops this member
function diskMark(limit: SpaceLimit, viewer: Viewer): RawHtml {
  switch (limit) {
    case 'allowance':
      return html``;
    case 'disk':
      return html` <span class="chip warn">${viewer.t('limited by the disk')}</span>`;
  }
}

export function adminUsersPage(
  users: readonly SeedboxUser[],
  logins: ReadonlyMap<string, MemberLogin>,
  disk: DiskReadings,
  viewer: Viewer,
  message?: string,
): string {
  const rows = users.map((user) => {
    const login = logins.get(user.username.value);
    const usage = disk.usages.get(user.username.value);
    return html`<tr>
  <td><a href="/admin/users/${user.username.value}">${user.username.value}</a></td>
  <td>${user.email.value}</td>
  <td class="num">${formatBytes(user.quota.toBytes(), viewer.t)}</td>
  ${usedCell(usage, viewer)}${freeCell(measuredSpace(user, usage, disk.volume), viewer)}
  <td>${login === undefined
    ? html`<span class="muted">${viewer.t('No portal login')}</span>`
    : viewer.t(ROLE_LABELS[login.role])}</td>
  <td class="num">${user.scgiPort.value}</td>
  <td>${login?.invited === true
    ? invitationChip(user.username.value, viewer)
    : statusChip(user, viewer)}</td>
</tr>`;
  });
  return page(
    'Members',
    html`<h1>${viewer.t('Members')}</h1>
<p class="muted">${viewer.t('members.intro')}</p>
<p class="muted">${viewer.t('members.suspend')}</p>
${flash(viewer.t, message)}
${boxDisk(users, disk.volume, viewer)}
<table>
  <thead>
    <tr><th>${viewer.t('User')}</th><th>${viewer.t('Email')}</th><th>${viewer.t('Quota')}</th><th>${viewer.t('Used')}</th><th>${viewer.t('Free')}</th><th>${viewer.t('Role')}</th><th>${viewer.t('SCGI')}</th><th>${viewer.t('Status')}</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<h2>${viewer.t('Invite a member')}</h2>
<p class="muted">${viewer.t('members.invite')}</p>
<form class="card" method="post" action="/admin/users">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="username">${viewer.t('Username')}</label>
  <input id="username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="email">${viewer.t('Email')}</label>
  <input id="email" name="email" type="email" required>
  <label for="quotaGib">${viewer.t('Quota (GiB)')}</label>
  <input id="quotaGib" name="quotaGib" type="number" min="1" value="412">
  <label for="role">${viewer.t('Portal role')}</label>
  <select id="role" name="role">${roleOptions('user')}</select>
  <button type="submit">${viewer.t('Send the invitation')}</button>
</form>`,
    viewer,
    'admin',
  );
}

// The one per-member policy an admin can move. It is phrased as what the member
// will be able to do, not as the column name: "allow_public_tracker" tells you
// nothing about the consequence, and the consequence is the whole decision.
function publicTrackers(name: string, instance: TorrentInstance | undefined, viewer: Viewer): RawHtml {
  if (instance === undefined) {
    return html`<p class="muted">${viewer.t('No rTorrent instance yet, so there is nothing to allow.')}</p>`;
  }
  const allowed = instance.allowPublicTracker;
  return html`<p>${sentence(viewer.t, '{name} can currently add torrents from {which}.', {
    name: html`${name}`,
    which: html`<strong>${viewer.t(allowed ? 'any tracker, public ones included' : 'private trackers only')}</strong>`,
  })}</p>
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
    return html`<p class="muted">${viewer.t('No rTorrent instance yet, so nothing runs.')}</p>`;
  }
  const run = !instance.syncDisabled;
  return html`<p>${sentence(viewer.t, "Scripts in {path} currently {state} when one of {name}'s downloads finishes.", {
    path: html`<span class="mono">${HOME_BASE}/${name}/scripts</span>`,
    state: html`<strong>${viewer.t(run ? 'run' : 'do not run')}</strong>`,
    name: html`${name}`,
  })}</p>
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
function storage(
  user: SeedboxUser,
  usage: DiskUsageSample | undefined,
  volume: VolumeSample | undefined,
  viewer: Viewer,
): RawHtml {
  const name = user.username.value;
  const allowance = user.quota.toGib();
  const used =
    usage === undefined
      ? html`<p class="muted">${viewer.t('Nothing measured yet. The hourly pass writes this down.')}</p>`
      : html`<p>${viewer.t('storage.using', { used: String(usage.used.toGib()), allowance: String(allowance) })}
(<span class="muted">${viewer.t('storage.measured', { at: usage.sampledAt })}</span>).
${leftToFill(measuredSpace(user, usage, volume), viewer)}</p>`;
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
    return html`<p class="muted">${viewer.t('No rTorrent instance yet.')}</p>`;
  }
  const current = instance.recycling.value;
  const option = (value: string, label: string): RawHtml =>
    html`<option value="${value}" ${current === value ? html`selected` : html``}>${label}</option>`;
  return html`<p class="muted">${viewer.t('recycling.intro', { name })}</p>
<form method="post" action="/admin/users/${name}/recycling">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="mode">${viewer.t('What to do')}</label>
  <select id="mode" name="mode">
    ${option('none', viewer.t('Download it again (default)'))}
    ${option('copy', viewer.t('Copy the files, so they get their own'))}
    ${option('hardlink', viewer.t('Share the same files on disk'))}
  </select>
  <button type="submit">${viewer.t('Save')}</button>
</form>
<p class="muted">${viewer.t('recycling.tradeoff')}</p>`;
}

// An account created before the portal existed has no login yet, so there is
// no role to move until somebody gives it a password.
function portalRole(name: string, role: Role | undefined, viewer: Viewer): RawHtml {
  if (role === undefined) {
    return html`<p class="muted">${viewer.t('role.none')}</p>`;
  }
  return html`<p class="muted">${viewer.t('role.what')}</p>
<form method="post" action="/admin/users/${name}/role">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="role">${viewer.t('Portal role')}</label>
  <select id="role" name="role">${roleOptions(role)}</select>
  <button type="submit">${viewer.t('Save')}</button>
</form>`;
}

export function adminUserDetailPage(
  user: SeedboxUser,
  viewer: Viewer,
  role: Role | undefined,
  access: 'invited' | 'active',
  instance?: TorrentInstance,
  usage?: DiskUsageSample,
  volume?: VolumeSample,
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
    'User {name}',
    html`<h1>${name} ${statusChip(user, viewer)}</h1>
${flash(viewer.t, message)}
<div class="card">
  <p>${viewer.t('Email: {email}', { email: user.email.value })}<br>
  ${viewer.t('Quota: {quota} GiB', { quota: String(user.quota.toGib()) })}<br>
  ${sentence(viewer.t, 'SCGI port: {port}', { port: html`<span class="mono">${user.scgiPort.value}</span>` })} ·
  ${sentence(viewer.t, 'rTorrent port: {port}', { port: html`<span class="mono">${user.rtorrentPort.value}</span>` })}</p>
  ${lifecycle}
  <form class="inline" method="post" action="/admin/users/${name}/delete">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button type="submit" class="danger">${viewer.t('Delete (irreversible)')}</button>
  </form>
</div>

<h2>${viewer.t('Portal role')}</h2>
<div class="card">${portalRole(name, role, viewer)}</div>

<h2>${viewer.t('Storage')}</h2>
<div class="card">${storage(user, usage, volume, viewer)}</div>

<h2>${viewer.t('Nextcloud')}</h2>
<div class="card">
  <p class="muted">${viewer.t('nextcloud.what', { name })}</p>
</div>

<h2>${viewer.t('Reusing what is already here')}</h2>
<div class="card">${recycling(name, instance, viewer)}</div>

<h2>${viewer.t('Public trackers')}</h2>
<div class="card">${publicTrackers(name, instance, viewer)}</div>

<h2>${viewer.t('Their own scripts')}</h2>
<div class="card">${finishScripts(name, instance, viewer)}</div>

<h2>${viewer.t('Password')}</h2>
<form class="card" method="post" action="/admin/users/${name}/password-link">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <p class="muted">${viewer.t(access === 'invited' ? 'password.invited' : 'password.active', { name })}</p>
  <button type="submit">${viewer.t(access === 'invited' ? 'Resend the invitation' : 'Send a reset link')}</button>
</form>`,
    viewer,
    'admin',
    { entry: 'Members', titleValues: { name } },
  );
}
