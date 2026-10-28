import type { DynDnsBinding } from '../../../domain/security/ports.js';
import type { FairUseLevel, FairUseAuditEntry, UsageSample } from '../../../domain/security/ports.js';
import type { UserAddress } from '../../../domain/tracker/ports.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, sentence, type Viewer } from './layout.js';
import type { Translate } from './messages.js';

export function adminAddressesPage(
  addresses: readonly UserAddress[],
  hostnames: readonly DynDnsBinding[],
  viewer: Viewer,
  message?: string,
): string {
  const addressRows = addresses.map(
    (address) => html`<tr>
  <td>${address.username.value}</td>
  <td class="mono">${address.ip.value}</td>
  <td>
    <form class="inline" method="post" action="/admin/addresses/remove">
      <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
      <input type="hidden" name="username" value="${address.username.value}">
      <input type="hidden" name="ipv4" value="${address.ip.value}">
      <button type="submit" class="ghost danger">${viewer.t('Remove')}</button>
    </form>
  </td>
</tr>`,
  );
  const hostnameRows = hostnames.map(
    (binding) => html`<tr>
  <td>${binding.username.value}</td>
  <td class="mono">${binding.host.value}</td>
  <td class="mono">${binding.resolvedIp?.value ?? viewer.t('unresolved')}</td>
  <td>
    <form class="inline" method="post" action="/admin/addresses/remove-hostname">
      <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
      <input type="hidden" name="username" value="${binding.username.value}">
      <input type="hidden" name="hostname" value="${binding.host.value}">
      <button type="submit" class="ghost danger">${viewer.t('Remove')}</button>
    </form>
  </td>
</tr>`,
  );
  return page(
    'Addresses',
    html`<h1>${viewer.t('Member addresses')}</h1>
<p>${sentence(viewer.t, "The portal, ruTorrent, Nextcloud and the VPN are open to all, behind each member's username and password. SSH and SFTP answer only the addresses and hostnames below and the VPN, as soon as one address is declared. Members declare their own addresses and dynamic hostnames in {account}; add one here for them when they ask.", {
  account: html`<a href="/access">${viewer.t('Account')}</a>`,
})}</p>
<p class="muted">${viewer.t("An address listed here is a member's own fixed connection, such as their home, trusted beyond that: the firewall accepts it on every port of the box, ahead of the blocklists; fail2ban never bans it; and their folder is shared to it over NFS without the VPN. List only an address you trust that much.")}</p>
<p class="muted">${sentence(viewer.t, 'Use a {dyndns} when their home address changes, which it usually does. KoBox re-resolves it on a schedule and follows it without anyone touching the firewall; the last resolved address is shown so you can tell a stale entry from a live one.', {
  dyndns: html`<strong>${viewer.t('DynDNS hostname')}</strong>`,
})}</p>
${flash(viewer.t, message)}
<table>
  <thead><tr><th>${viewer.t('User')}</th><th>IPv4</th><th></th></tr></thead>
  <tbody>${addressRows}</tbody>
</table>
<form class="card" method="post" action="/admin/addresses/add">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="add-username">${viewer.t('Username')}</label>
  <input id="add-username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="add-ipv4">IPv4</label>
  <input id="add-ipv4" name="ipv4" required>
  <button type="submit">${viewer.t('Add address')}</button>
</form>

<h2>${viewer.t('DynDNS hostnames')}</h2>
<table>
  <thead><tr><th>${viewer.t('User')}</th><th>${viewer.t('Hostname')}</th><th>${viewer.t('Last resolved')}</th><th></th></tr></thead>
  <tbody>${hostnameRows}</tbody>
</table>
<form class="card" method="post" action="/admin/addresses/add-hostname">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="host-username">${viewer.t('Username')}</label>
  <input id="host-username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="host-hostname">${viewer.t('Hostname')}</label>
  <input id="host-hostname" name="hostname" required>
  <button type="submit">${viewer.t('Add hostname')}</button>
</form>`,
    viewer,
    'admin',
  );
}

export interface FairUseRow {
  readonly username: string;
  readonly level: FairUseLevel;
  readonly health: string;
  readonly sample?: UsageSample;
  readonly events: readonly FairUseAuditEntry[];
}

function levelChip(level: FairUseLevel, t: Translate): RawHtml {
  if (level === 'throttled') {
    return html`<span class="chip bad">${t('throttled')}</span>`;
  }
  if (level === 'alerted') {
    return html`<span class="chip warn">${t('alerted')}</span>`;
  }
  return html`<span class="chip ok">${t('none')}</span>`;
}

function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

export function adminFairUsePage(
  rows: readonly FairUseRow[],
  viewer: Viewer,
  message?: string,
): string {
  const tableRows = rows.map(
    (row) => html`<tr>
  <td>${row.username}</td>
  <td>${levelChip(row.level, viewer.t)}</td>
  <td>${row.health}</td>
  <td class="num">${row.sample === undefined ? '—' : formatGib(row.sample.egressBytes)}</td>
  <td class="num">${row.sample === undefined ? '—' : formatGib(row.sample.ingressBytes)}</td>
  <td class="mono">${row.sample?.sampledAt ?? '—'}</td>
</tr>`,
  );
  const eventBlocks = rows
    .filter((row) => row.events.length > 0)
    .map(
      (row) => html`<h3>${row.username}</h3>
<table>
  <thead><tr><th>${viewer.t('When')}</th><th>${viewer.t('Event')}</th><th>${viewer.t('Detail')}</th></tr></thead>
  <tbody>${row.events
    .slice(-10)
    .reverse()
    .map(
      (event) => html`<tr>
    <td class="mono">${event.createdAt}</td>
    <td>${event.eventType}</td>
    <td class="mono">${event.detailJson}</td>
  </tr>`,
    )}</tbody>
</table>`,
    );
  return page(
    'Fair use',
    html`<h1>${viewer.t('Fair use')}</h1>
<p class="muted">${sentence(viewer.t, 'One member saturating the link makes the box unusable for everyone else. KoBox samples what each one actually moves and answers in steps rather than cutting them off: {none} is the normal state, {alerted} means they have been told, {throttled} means their bandwidth is capped until they come back under. Nothing here deletes anything or suspends an account.', {
  none: html`<strong>${viewer.t('none')}</strong>`,
  alerted: html`<strong>${viewer.t('alerted')}</strong>`,
  throttled: html`<strong>${viewer.t('throttled')}</strong>`,
})}</p>
<p class="muted">${sentence(viewer.t, 'Every decision is recorded below, and every one is reversible: a {override} raises the limit for a member who has a reason, without changing it for anyone else.', {
  override: html`<strong>${viewer.t('budget override')}</strong>`,
})}</p>
${flash(viewer.t, message)}
<table>
  <thead>
    <tr><th>${viewer.t('User')}</th><th>${viewer.t('Level')}</th><th>${viewer.t('Health')}</th><th>${viewer.t('Egress')}</th><th>${viewer.t('Ingress')}</th><th>${viewer.t('Sampled')}</th></tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>

<h2>${viewer.t('Budget override')}</h2>
<form class="card" method="post" action="/admin/fair-use/override">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="ov-username">${viewer.t('Username')}</label>
  <input id="ov-username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="ov-egress">${viewer.t('Sustained egress (Mbit/s, empty = keep, "clear" = default)')}</label>
  <input id="ov-egress" name="egressLimitMbit">
  <label for="ov-auth">${viewer.t('SSH auths per hour (empty = keep, "clear" = default)')}</label>
  <input id="ov-auth" name="authRatePerHour">
  <label for="ov-throttle">${viewer.t('Throttle target (Mbit/s, empty = keep, "clear" = default)')}</label>
  <input id="ov-throttle" name="throttleToMbit">
  <button type="submit">${viewer.t('Apply override')}</button>
</form>

<h2>${viewer.t('Recent events')}</h2>
${eventBlocks}`,
    viewer,
    'admin',
  );
}
