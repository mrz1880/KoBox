import type { SyncDestination } from '../../../domain/sync/SyncDestination.js';
import { SyncMode } from '../../../domain/torrent/SyncMode.js';
import type { WatchDir } from '../../../domain/torrent/WatchDir.js';
import { html, type RawHtml } from '../html.js';
import { destinationSection } from './destinationSection.js';
import { flash, page, type Viewer } from './layout.js';

// The three modes in the words a member would use about their own files. The
// legacy offered "Ignore les scripts (Pas de synchro)" — accurate about the
// implementation, silent about what actually happens to your download.
const MODE_WORDS: Readonly<Record<string, { readonly label: string; readonly hint: string }>> = {
  off: {
    label: 'Keep it here',
    hint: 'Nothing leaves the box. Download it yourself whenever you like.',
  },
  scheduled: {
    label: 'Send it a bit later',
    hint: 'It goes out on the next pass, a few minutes after it finishes.',
  },
  immediate: {
    label: 'Send it straight away',
    hint: 'It starts copying the moment the download is done.',
  },
};

function modeChoice(dir: WatchDir, viewer: Viewer): RawHtml {
  const label = dir.label?.value ?? '';
  const options = SyncMode.all().map(
    (mode) => html`<option value="${mode.value}"${
      mode.equals(dir.syncMode) ? html` selected` : html``
    }>${MODE_WORDS[mode.value]?.label ?? mode.value}</option>`,
  );
  return html`<form class="inline" method="post" action="/sync/categories/mode">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <input type="hidden" name="label" value="${label}">
  <select name="mode" aria-label="What happens to a finished ${label} download">${options}</select>
  <button class="ghost" type="submit">Save</button>
</form>`;
}

export function syncPage(
  categories: readonly WatchDir[],
  destination: SyncDestination | undefined,
  viewer: Viewer,
  message?: string,
): string {
  const rows = categories.map(
    (dir) => html`<tr>
  <td>${dir.label?.value ?? ''}</td>
  <td>${modeChoice(dir, viewer)}</td>
  <td class="muted">${MODE_WORDS[dir.syncMode.value]?.hint ?? ''}</td>
</tr>`,
  );
  return page(
    'Sending',
    html`<h1>Your folders</h1>
<p class="muted">A folder is what you sort your downloads into. Drop a torrent in
a folder's watch directory and what comes out lands in that folder — and, if you
ask for it here, gets copied on to your own machine.</p>
${flash(message)}
${categories.length === 0
      ? html`<p class="lead">You have no folders yet.</p>`
      : html`<table>
  <thead><tr><th>Folder</th><th>When a download finishes</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>`}

<h2>Add a folder</h2>
<form class="inline" method="post" action="/sync/categories">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <input name="label" placeholder="films" maxlength="64" required>
  <button type="submit">Add it</button>
</form>
<p class="muted">Letters, digits, dot, dash or underscore — no spaces and no
accents, because it becomes a folder name on this box and on your own machine.
New folders keep everything here until you say otherwise.</p>

${destinationSection(destination, viewer)}`,
    viewer,
  );
}
