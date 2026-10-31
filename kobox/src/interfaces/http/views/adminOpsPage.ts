import type { ReleaseRecord, ReleaseState } from '../../../application/maintenance/ReleaseRepositoryPort.js';
import type { OutboxMail } from '../../../application/maintenance/MailOutboxPort.js';
import type { ComponentRecord } from '../../../domain/installation/ports.js';
import type { Speedtest } from '../../../domain/maintenance/speedtest.js';
import { ManagedService } from '../../../domain/maintenance/ManagedService.js';
import type { HealthCheckResult } from '../../../domain/user/ports.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, rowsOrEmpty, sentence, type Viewer } from './layout.js';
import { formatMoment } from './moment.js';
import type { Translate } from './messages.js';

function healthChip(state: string, t: Translate): RawHtml {
  return state === 'healthy'
    ? html`<span class="chip ok">${t('healthy')}</span>`
    : html`<span class="chip bad">${t('unhealthy')}</span>`;
}

function componentChip(state: string, t: Translate): RawHtml {
  if (state === 'installed') {
    return html`<span class="chip ok">${t('installed')}</span>`;
  }
  if (state === 'failed') {
    return html`<span class="chip bad">${t('failed')}</span>`;
  }
  if (state === 'skipped') {
    return html`<span class="chip warn">${t('skipped')}</span>`;
  }
  return html`<span class="chip">${state}</span>`;
}

// Rates read best as round Mbit/s: the exact bit count is noise here.
function toMbit(bps: number): string {
  return `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
}

// A single figure says little; the series is what tells you the link is drifting.
// The measurement saturates the connection, so the cost is stated next to the
// button rather than discovered afterwards.
function linkSpeedSection(
  viewer: Viewer,
  measurements: readonly Speedtest[],
  available: boolean,
): RawHtml {
  const rows = measurements.map(
    (measurement) => html`<tr>
  <td class="num">${toMbit(measurement.download.bps)}</td>
  <td class="num">${toMbit(measurement.upload.bps)}</td>
  <td class="num">${measurement.latencyMs} ms</td>
  <td>${measurement.server}</td>
  <td class="when">${measurement.measuredAt}</td>
</tr>`,
  );
  return html`<h2>${viewer.t('Link speed')}</h2>
${available
    ? html`<form class="inline" method="post" action="/admin/speedtest">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button type="submit">${viewer.t('Measure now')}</button>
</form>
<p class="muted">${viewer.t('Saturates the connection for about ten seconds, so downloads slow down while it runs, and a measurement taken while the box is busy reads low. Nothing schedules it.')}</p>`
    : html`<p class="muted">${sentence(viewer.t, 'No measurement binary pinned. Set {url} and {checksum}, then run {install}.', {
      url: html`<span class="mono">KOBOX_SPEEDTEST_URL</span>`,
      checksum: html`<span class="mono">KOBOX_SPEEDTEST_SHA256</span>`,
      install: html`<span class="mono">kobox install</span>`,
    })}</p>`}
${measurements.length === 0
    ? html`<p class="muted">${viewer.t('No measurement yet.')}</p>`
    : html`<table>
  <thead><tr><th>${viewer.t('Down')}</th><th>${viewer.t('Up')}</th><th>${viewer.t('Latency')}</th><th>${viewer.t('Server')}</th><th>${viewer.t('Measured')}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`}`;
}

// One row per unit KoBox manages, each with a restart. The list comes from the
// closed ManagedService type, so this screen cannot offer a unit the worker
// would refuse — the form and the guard can never drift apart.
function managedServicesSection(viewer: Viewer): RawHtml {
  const rows = ManagedService.all().map(
    (name) => html`<tr>
  <td class="mono">${name}</td>
  <td class="act"><form class="inline" method="post" action="/admin/services/restart">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <input type="hidden" name="service" value="${name}">
    <button class="ghost" type="submit">${viewer.t('Restart')}</button>
  </form></td>
</tr>`,
  );
  return html`<h2>${viewer.t('Managed services')}</h2>
<p class="muted">${viewer.t('The worker itself is not here on purpose: it is what carries out the restart, so restarting it from this page would kill the job mid-flight.')}</p>
<table>
  <thead><tr><th>${viewer.t('Unit')}</th><th class="act">${viewer.t('Action')}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

const RELEASE_STATES: Record<ReleaseState, string> = {
  staged: 'staged',
  current: 'in service',
  previous: 'previous',
  failed: 'failed',
};

export function adminHealthPage(
  probes: readonly HealthCheckResult[],
  components: readonly ComponentRecord[],
  releases: readonly ReleaseRecord[],
  viewer: Viewer,
  measurements: readonly Speedtest[] = [],
  speedtestAvailable = false,
  message?: string,
): string {
  const probeRows = probes.map(
    (probe) => html`<tr>
  <td class="mono">${probe.name}</td>
  <td>${healthChip(probe.state, viewer.t)}</td>
  <td>${probe.detail ?? ''}</td>
</tr>`,
  );
  const componentRows = components.map(
    (component) => html`<tr>
  <td>${component.name.value}</td>
  <td>${componentChip(component.state.value, viewer.t)}</td>
  <td class="mono">${component.version?.value ?? ''}</td>
  <td>${component.reason ?? ''}</td>
</tr>`,
  );
  const releaseRows = releases.map(
    (release) => html`<tr>
  <td class="mono">${release.ref}</td>
  <td>${viewer.t(RELEASE_STATES[release.state])}</td>
  <td>${formatMoment(release.createdAt, viewer)}</td>
  <td>${release.switchedAt === undefined
    ? html`<span class="muted">${viewer.t('not yet')}</span>`
    : formatMoment(release.switchedAt, viewer)}</td>
</tr>`,
  );
  return page(
    'Health',
    html`<h1>${viewer.t('Health')}</h1>
${flash(viewer.t, message)}
<p class="links"><a href="/monitoring">${viewer.t('Monitoring of the machine: CPU, memory, network, disks')}</a></p>
<h2>${viewer.t('Service probes')}</h2>
<table>
  <thead><tr><th>${viewer.t('Probe')}</th><th>${viewer.t('State')}</th><th>${viewer.t('Detail')}</th></tr></thead>
  <tbody>${probeRows}</tbody>
</table>

${managedServicesSection(viewer)}

${linkSpeedSection(viewer, measurements, speedtestAvailable)}

<h2>${viewer.t('Components')}</h2>
<table>
  <thead><tr><th>${viewer.t('Component')}</th><th>${viewer.t('State')}</th><th>${viewer.t('Version')}</th><th>${viewer.t('Reason')}</th></tr></thead>
  <tbody>${rowsOrEmpty(componentRows, { columns: 4, message: 'No component installed yet.' }, viewer.t)}</tbody>
</table>

<h2>${viewer.t('Releases')}</h2>
<table>
  <thead><tr><th>${viewer.t('Ref')}</th><th>${viewer.t('State')}</th><th>${viewer.t('Created')}</th><th>${viewer.t('Switched')}</th></tr></thead>
  <tbody>${rowsOrEmpty(releaseRows, { columns: 4, message: 'No release deployed yet.' }, viewer.t)}</tbody>
</table>`,
    viewer,
    'admin',
  );
}

function mailChip(status: string, t: Translate): RawHtml {
  if (status === 'sent') {
    return html`<span class="chip ok">${t('sent')}</span>`;
  }
  if (status === 'failed') {
    return html`<span class="chip bad">${t('failed')}</span>`;
  }
  return html`<span class="chip warn">${t('pending')}</span>`;
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
  <td>${mailChip(mail.status, viewer.t)}</td>
  <td class="num">${mail.attempts}</td>
  <td>${mail.lastError ?? ''}</td>
</tr>`,
  );
  return page(
    'Mails',
    html`<h1>${viewer.t('Mail outbox')}</h1>
${flash(viewer.t, message)}
<table>
  <thead>
    <tr><th>${viewer.t('Created')}</th><th>${viewer.t('Recipient')}</th><th>${viewer.t('Subject')}</th><th>${viewer.t('Status')}</th><th>${viewer.t('Attempts')}</th><th>${viewer.t('Last error')}</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`,
    viewer,
    'admin',
  );
}
