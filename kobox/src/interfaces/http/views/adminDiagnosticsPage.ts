import type {
  PackageUpdateSnapshot,
  ServiceLogSnapshot,
} from '../../../application/maintenance/DiagnosticsPort.js';
import { LoggableService } from '../../../domain/maintenance/ManagedService.js';
import { html, type RawHtml } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

// An excerpt is a photograph, not a live feed. Saying when it was taken is the
// difference between a diagnosis and a wrong one — nothing on this page auto-
// refreshes, so the timestamp is the only thing that can say "this is old".
function logCard(unit: string, snapshot: ServiceLogSnapshot | undefined, viewer: Viewer): RawHtml {
  return html`<section class="panel">
  <div class="eyebrow">
    <span class="mono">${unit}</span>
    ${snapshot === undefined
      ? html`<span class="muted">never captured</span>`
      : html`<span class="muted">captured ${snapshot.capturedAt}</span>`}
  </div>
  <form class="inline" method="post" action="/admin/logs/capture">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <input type="hidden" name="service" value="${unit}">
    <button class="ghost" type="submit">Capture now</button>
  </form>
  ${snapshot === undefined
    ? html`<p class="muted">Capture to see the last lines this unit wrote.</p>`
    : html`<pre class="log">${snapshot.content}</pre>`}
</section>`;
}

export function adminLogsPage(
  snapshots: readonly ServiceLogSnapshot[],
  viewer: Viewer,
  message?: string,
): string {
  const byUnit = new Map(snapshots.map((snapshot) => [snapshot.unit, snapshot]));
  // driven by the closed LoggableService set, so a unit the worker would refuse
  // can never appear as a button here
  const cards = LoggableService.all().map((unit) => logCard(unit, byUnit.get(unit), viewer));
  return page(
    'Logs',
    html`<h1>${viewer.t('Logs')}</h1>
<p class="muted">The last 200 lines each KoBox unit wrote, captured on demand.
Only these units — reading the whole host journal from a web page is not
something this portal is allowed to do.</p>
${flash(message)}
${cards}`,
    viewer,
  );
}

// Two buttons, deliberately not one. Checking is free and tells you where you
// stand; applying restarts daemons and can break a running box. Merging them
// into "update" would make the second happen by accident.
export function adminPackagesPage(
  snapshot: PackageUpdateSnapshot | undefined,
  viewer: Viewer,
  message?: string,
): string {
  const lines = snapshot === undefined ? [] : snapshot.listing.split('\n').filter(Boolean);
  return page(
    'Updates',
    html`<h1>System updates</h1>
${flash(message)}
<section class="panel">
  <div class="eyebrow">
    ${snapshot === undefined
      ? html`<span class="muted">never checked</span>`
      : html`<span class="muted">checked ${snapshot.checkedAt}</span>`}
  </div>
  ${snapshot === undefined
    ? html`<p class="lead">Nobody has looked yet.</p>`
    : snapshot.upgradableCount === 0
      ? html`<p class="lead">Everything is up to date.</p>`
      : html`<p class="lead">${snapshot.upgradableCount} package${
          snapshot.upgradableCount === 1 ? '' : 's'
        } can be updated.</p>`}
  <div class="choices">
    <form class="inline" method="post" action="/admin/packages/check">
      <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
      <button class="ghost" type="submit">Check for updates</button>
    </form>
    <form class="inline" method="post" action="/admin/packages/apply">
      <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
      <button type="submit">Install them</button>
    </form>
  </div>
  <p class="muted">Installing restarts the daemons that were updated, so
  transfers can drop for a moment. It never reboots and never removes a package.</p>
</section>
${lines.length === 0
  ? html``
  : html`<table>
  <thead><tr><th>Package</th></tr></thead>
  <tbody>${lines.map((line) => html`<tr><td class="mono">${line}</td></tr>`)}</tbody>
</table>`}`,
    viewer,
  );
}
