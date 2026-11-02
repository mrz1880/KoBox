import type { CleanupCandidate, CleanupReason } from '../../../domain/space/CleanupCandidate.js';
import type { CleanupReport, SkipReason } from '../../../domain/space/CleanupReport.js';
import type { CleanupProposal, ProposalLine } from '../../../domain/space/CleanupProposal.js';
import { instantOf, stampOf } from '../../../domain/shared/stamp.js';
import { html, type RawHtml } from '../html.js';
import { formatBytes } from './bytes.js';
import { flash, page, type Reader, type Viewer } from './layout.js';
import { formatDay, formatMoment } from './moment.js';

// What the page offers: the proposal built from the hourly pass's snapshot,
// and when that pass ran.
export interface CleanupList {
  readonly proposal: CleanupProposal;
  readonly takenAt: string;
}

// A ratio to one decimal, or two when the second one says something, with the
// reader's own decimal mark.
function formatRatio(ratio: number, reader: Reader): string {
  return ratio.toLocaleString(reader.language.value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

// Why a line may go, in the words of when the list was made. `takenAt` is a
// stamp, the candidate's dates ISO instants. KoBox only knows what its own sync
// sent, so a seeded line says it cannot tell whether the member fetched it.
function why(candidate: CleanupCandidate, takenAt: string, reader: Reader): RawHtml {
  const said: Readonly<Record<CleanupReason, () => RawHtml>> = {
    seeded: () => {
      const days = candidate.daysSeeded(instantOf(takenAt));
      const one = new Intl.PluralRules(reader.language.value).select(days) === 'one';
      const ratio = reader.t(one ? 'Ratio {ratio} after {days} day' : 'Ratio {ratio} after {days} days', {
        ratio: formatRatio(candidate.ratio, reader),
        days: String(days),
      });
      return html`${ratio}<br><span class="muted">${reader.t('KoBox does not know whether you fetched it.')}</span>`;
    },
    alreadySent: () => html`${reader.t('Already sent to your machine')}`,
  };
  return said[candidate.reason]();
}

function row(line: ProposalLine, takenAt: string, viewer: Viewer): RawHtml {
  const { candidate } = line;
  return html`<tr>
  <td class="pick"><input type="checkbox" name="pick" value="${candidate.infoHash.value}"${line.checked ? html` checked` : html``} aria-label="${viewer.t('Delete {name}', { name: candidate.name })}"></td>
  <td class="path">${candidate.name}</td>
  <td class="num">${formatBytes(candidate.size.toBytes(), viewer)}</td>
  <td class="num ratio">${formatRatio(candidate.ratio, viewer)}</td>
  <td class="when finished">${formatDay(stampOf(new Date(candidate.finishedAt)), viewer)}</td>
  <td class="reason">${why(candidate, takenAt, viewer)}</td>
</tr>`;
}

// One form, two buttons: the first one, the one Enter presses, only counts
// again; the second one deletes.
function form(list: CleanupList, viewer: Viewer): RawHtml {
  const freed = formatBytes(list.proposal.freed().toBytes(), viewer);
  return html`<form method="post" action="/space/cleanup">
<input type="hidden" name="_csrf" value="${viewer.csrfToken}">
<table class="cleanup">
  <thead><tr><th class="pick">${viewer.t('Delete')}</th><th>${viewer.t('Torrent')}</th><th>${viewer.t('Size')}</th><th class="ratio">${viewer.t('Ratio')}</th><th class="finished">${viewer.t('Finished')}</th><th>${viewer.t('Why')}</th></tr></thead>
  <tbody>${list.proposal.lines.map((line) => row(line, list.takenAt, viewer))}</tbody>
</table>
<p class="flash warn">${viewer.t('The files will be erased from the seedbox for good. This cannot be undone.')}</p>
<button type="submit" class="ghost" formaction="/space/cleanup/recalculate">${viewer.t('Recalculate')}</button>
<button type="submit" class="danger">${viewer.t('Delete for good ({size})', { size: freed })}</button>
</form>`;
}

function content(list: CleanupList | undefined, viewer: Viewer): RawHtml {
  if (list === undefined) {
    return html`<p class="muted">${viewer.t('The first list arrives within the hour.')}</p>`;
  }
  const made = html`<p class="muted">${viewer.t('List from {when}.', { when: formatMoment(list.takenAt, viewer) })}</p>`;
  if (list.proposal.lines.length === 0) {
    return html`<p>${viewer.t('Nothing to clean yet: your torrents are still seeding.')}</p>
${made}`;
  }
  return html`${made}
${form(list, viewer)}`;
}

// Why a torrent the member picked is still there, said once per reason. A
// record, so a new reason does not compile until it has its sentence.
const KEPT_BECAUSE: Readonly<Record<SkipReason, string>> = {
  noLongerQualifies: 'Kept: it no longer qualifies, it was restarted or is being sent to your machine.',
  gone: 'Already gone from your torrents.',
  notErased: 'Kept: rTorrent refused to let it go, so its files were left alone.',
  dataKept: 'Removed from rTorrent, but its files could not be erased: they are still in your files.',
};

function deletedTable(report: CleanupReport, viewer: Viewer): RawHtml {
  if (report.deleted.length === 0) {
    return html``;
  }
  return html`<table>
  <thead><tr><th>${viewer.t('Deleted')}</th><th>${viewer.t('Size')}</th></tr></thead>
  <tbody>${report.deleted.map(
    (line) => html`<tr>
  <td class="path">${line.name}</td>
  <td class="num">${formatBytes(line.size.toBytes(), viewer)}</td>
</tr>`,
  )}</tbody>
</table>`;
}

function skippedTable(report: CleanupReport, viewer: Viewer): RawHtml {
  if (report.skipped.length === 0) {
    return html``;
  }
  return html`<table>
  <thead><tr><th>${viewer.t('Still there')}</th><th>${viewer.t('Why')}</th></tr></thead>
  <tbody>${report.skipped.map(
    (line) => html`<tr>
  <td class="path">${line.name}</td>
  <td class="reason">${viewer.t(KEPT_BECAUSE[line.reason])}</td>
</tr>`,
  )}</tbody>
</table>`;
}

// When a cleanup ran, what it gave back, and what went.
function deletedSummary(report: CleanupReport, viewer: Viewer): RawHtml {
  const when = formatMoment(report.at, viewer);
  return html`<p>${report.deleted.length === 0
    ? viewer.t('{when}: nothing was deleted.', { when })
    : viewer.t('{when}: {freed} freed.', { when, freed: formatBytes(report.freed.toBytes(), viewer) })}</p>
${deletedTable(report, viewer)}`;
}

// What the member's last cleanup did, first: they come back here after it.
function lastCleanup(report: CleanupReport | undefined, viewer: Viewer): RawHtml {
  if (report === undefined) {
    return html``;
  }
  return html`<h2>${viewer.t('Last cleanup')}</h2>
${deletedSummary(report, viewer)}
${skippedTable(report, viewer)}`;
}

// On the home, for a cleanup KoBox ran on its own: the member did not ask for
// it, so they are told what went, and where the rest of the story is.
export function automaticCleanupNotice(report: CleanupReport | undefined, viewer: Viewer): RawHtml {
  if (report === undefined) {
    return html``;
  }
  return html`<section class="panel">
<h2>${viewer.t('KoBox cleaned up for you')}</h2>
${deletedSummary(report, viewer)}
<p class="muted"><a href="/space/cleanup">${viewer.t('See the details')}</a></p>
</section>`;
}

// What the page shows: the list to pick from, and what the last cleanup did.
export interface CleanupPageFacts {
  readonly list: CleanupList | undefined;
  readonly report: CleanupReport | undefined;
}

// Where a member frees their space: what the hourly pass found they could
// delete, and the button that deletes it.
export function spaceCleanupPage(
  viewer: Viewer,
  facts: CleanupPageFacts,
  message?: string,
): string {
  return page(
    'Free up space',
    html`<h1>${viewer.t('Free up space')}</h1>
${flash(viewer.t, message)}
${lastCleanup(facts.report, viewer)}
<h2>${viewer.t('What can be deleted')}</h2>
${content(facts.list, viewer)}`,
    viewer,
    'seedbox',
    { entry: 'Home', titleValues: {} },
  );
}
