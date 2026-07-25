import type { ReleaseRecord } from '../../../application/maintenance/ReleaseRepositoryPort.js';
import type { OutboxMail } from '../../../application/maintenance/MailOutboxPort.js';
import type { ComponentRecord } from '../../../domain/installation/ports.js';
import type { HealthCheckResult } from '../../../domain/user/ports.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

function healthChip(state: string): RawHtml {
  return state === 'healthy'
    ? html`<span class="chip ok">healthy</span>`
    : html`<span class="chip bad">unhealthy</span>`;
}

function componentChip(state: string): RawHtml {
  if (state === 'installed') {
    return html`<span class="chip ok">installed</span>`;
  }
  if (state === 'failed') {
    return html`<span class="chip bad">failed</span>`;
  }
  if (state === 'skipped') {
    return html`<span class="chip warn">skipped</span>`;
  }
  return html`<span class="chip">${state}</span>`;
}

export function adminHealthPage(
  probes: readonly HealthCheckResult[],
  components: readonly ComponentRecord[],
  releases: readonly ReleaseRecord[],
  viewer: Viewer,
  message?: string,
): string {
  const probeRows = probes.map(
    (probe) => html`<tr>
  <td class="mono">${probe.name}</td>
  <td>${healthChip(probe.state)}</td>
  <td>${probe.detail ?? ''}</td>
</tr>`,
  );
  const componentRows = components.map(
    (component) => html`<tr>
  <td>${component.name.value}</td>
  <td>${componentChip(component.state.value)}</td>
  <td class="mono">${component.version?.value ?? '—'}</td>
  <td>${component.reason ?? ''}</td>
</tr>`,
  );
  const releaseRows = releases.map(
    (release) => html`<tr>
  <td class="mono">${release.ref}</td>
  <td>${release.state}</td>
  <td class="mono">${release.createdAt}</td>
  <td class="mono">${release.switchedAt ?? '—'}</td>
</tr>`,
  );
  return page(
    'Health',
    html`<h1>Health</h1>
${flash(message)}
<h2>Service probes</h2>
<table>
  <thead><tr><th>Probe</th><th>State</th><th>Detail</th></tr></thead>
  <tbody>${probeRows}</tbody>
</table>

<h2>Components</h2>
<table>
  <thead><tr><th>Component</th><th>State</th><th>Version</th><th>Reason</th></tr></thead>
  <tbody>${componentRows}</tbody>
</table>

<h2>Releases</h2>
<table>
  <thead><tr><th>Ref</th><th>State</th><th>Created</th><th>Switched</th></tr></thead>
  <tbody>${releaseRows}</tbody>
</table>`,
    viewer,
  );
}

function mailChip(status: string): RawHtml {
  if (status === 'sent') {
    return html`<span class="chip ok">sent</span>`;
  }
  if (status === 'failed') {
    return html`<span class="chip bad">failed</span>`;
  }
  return html`<span class="chip warn">pending</span>`;
}

export function adminMailsPage(
  mails: readonly OutboxMail[],
  viewer: Viewer,
  message?: string,
): string {
  const rows = mails.map(
    (mail) => html`<tr>
  <td class="mono">${mail.createdAt}</td>
  <td>${mail.recipient}</td>
  <td>${mail.subject}</td>
  <td>${mailChip(mail.status)}</td>
  <td class="num">${mail.attempts}</td>
  <td>${mail.lastError ?? ''}</td>
</tr>`,
  );
  return page(
    'Mails',
    html`<h1>Mail outbox</h1>
${flash(message)}
<table>
  <thead>
    <tr><th>Created</th><th>Recipient</th><th>Subject</th><th>Status</th><th>Attempts</th><th>Last error</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
  );
}
