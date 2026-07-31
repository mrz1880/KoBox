import type { DynDnsBinding } from '../../../domain/security/ports.js';
import type { FairUseLevel, FairUseAuditEntry, UsageSample } from '../../../domain/security/ports.js';
import type { UserAddress } from '../../../domain/tracker/ports.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

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
      <button type="submit" class="ghost danger">Remove</button>
    </form>
  </td>
</tr>`,
  );
  const hostnameRows = hostnames.map(
    (binding) => html`<tr>
  <td>${binding.username.value}</td>
  <td class="mono">${binding.host.value}</td>
  <td class="mono">${binding.resolvedIp?.value ?? 'unresolved'}</td>
  <td>
    <form class="inline" method="post" action="/admin/addresses/remove-hostname">
      <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
      <input type="hidden" name="username" value="${binding.username.value}">
      <input type="hidden" name="hostname" value="${binding.host.value}">
      <button type="submit" class="ghost danger">Remove</button>
    </form>
  </td>
</tr>`,
  );
  return page(
    'Addresses',
    html`<h1>Member addresses</h1>
${flash(message)}
<p>Trusted IPs and DynDNS hostnames drive the firewall accepts, fail2ban
ignores, the tracker whitelist and the NFS exports.</p>
<table>
  <thead><tr><th>User</th><th>IPv4</th><th></th></tr></thead>
  <tbody>${addressRows}</tbody>
</table>
<form class="card" method="post" action="/admin/addresses/add">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="add-username">Username</label>
  <input id="add-username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="add-ipv4">IPv4</label>
  <input id="add-ipv4" name="ipv4" required>
  <button type="submit">Add address</button>
</form>

<h2>DynDNS hostnames</h2>
<table>
  <thead><tr><th>User</th><th>Hostname</th><th>Last resolved</th><th></th></tr></thead>
  <tbody>${hostnameRows}</tbody>
</table>
<form class="card" method="post" action="/admin/addresses/add-hostname">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="host-username">Username</label>
  <input id="host-username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="host-hostname">Hostname</label>
  <input id="host-hostname" name="hostname" required>
  <button type="submit">Add hostname</button>
</form>`,
    viewer,
  );
}

export interface FairUseRow {
  readonly username: string;
  readonly level: FairUseLevel;
  readonly health: string;
  readonly sample?: UsageSample;
  readonly events: readonly FairUseAuditEntry[];
}

function levelChip(level: FairUseLevel): RawHtml {
  if (level === 'throttled') {
    return html`<span class="chip bad">throttled</span>`;
  }
  if (level === 'alerted') {
    return html`<span class="chip warn">alerted</span>`;
  }
  return html`<span class="chip ok">none</span>`;
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
  <td>${levelChip(row.level)}</td>
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
  <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
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
    html`<h1>Fair use</h1>
${flash(message)}
<table>
  <thead>
    <tr><th>User</th><th>Level</th><th>Health</th><th>Egress</th><th>Ingress</th><th>Sampled</th></tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>

<h2>Budget override</h2>
<form class="card" method="post" action="/admin/fair-use/override">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="ov-username">Username</label>
  <input id="ov-username" name="username" required pattern="[a-z][a-z0-9]{0,31}">
  <label for="ov-egress">Sustained egress (Mbit/s, empty = keep, "clear" = default)</label>
  <input id="ov-egress" name="egressLimitMbit">
  <label for="ov-auth">SSH auths per hour (empty = keep, "clear" = default)</label>
  <input id="ov-auth" name="authRatePerHour">
  <label for="ov-throttle">Throttle target (Mbit/s, empty = keep, "clear" = default)</label>
  <input id="ov-throttle" name="throttleToMbit">
  <button type="submit">Apply override</button>
</form>

<h2>Recent events</h2>
${eventBlocks}`,
    viewer,
  );
}
