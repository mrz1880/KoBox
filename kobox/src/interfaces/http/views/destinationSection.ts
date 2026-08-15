import { LoneFilePlacement } from '../../../domain/sync/LoneFilePlacement.js';
import type { SyncDestination } from '../../../domain/sync/SyncDestination.js';
import { html, type RawHtml } from '../html.js';
import type { Viewer } from './layout.js';

const PLACEMENT_WORDS: Readonly<Record<string, string>> = {
  'beside-the-others': 'Put the file straight in the folder',
  'in-its-own-folder': 'Give each file a folder of its own',
};

// The verdict of the last "test it now", stated as an outcome rather than as an
// exit code. A member who cannot fix what they cannot understand will simply
// turn sync off and stop trusting the screen.
function verdict(destination: SyncDestination | undefined): RawHtml {
  const check = destination?.lastCheck;
  if (destination === undefined) {
    return html``;
  }
  if (check === undefined) {
    return html`<p class="muted">Not tried yet. Test it before you rely on it.</p>`;
  }
  return html`<p class="eyebrow">
  ${check.ok ? html`<span class="chip ok">it works</span>` : html`<span class="chip bad">it does not work</span>`}
  <span class="muted">${check.detail ?? ''}</span>
</p>
<p class="muted">Last tried ${check.at}.${
    check.fingerprint === undefined
      ? html``
      : html` The machine identified itself as <span class="mono">${check.fingerprint}</span> — if
that ever changes without you reinstalling it, KoBox will refuse to connect and say so.`
  }</p>`;
}

// Everything a member needs to describe their own machine. The password field
// is deliberately never pre-filled: a form cannot show one back, and leaving it
// empty means "keep the one you already have" rather than "erase it".
export function destinationSection(
  destination: SyncDestination | undefined,
  viewer: Viewer,
): RawHtml {
  const placements = LoneFilePlacement.all().map(
    (placement) => html`<option value="${placement.value}"${
      placement.equals(destination?.placement ?? LoneFilePlacement.besideTheOthers)
        ? html` selected`
        : html``
    }>${PLACEMENT_WORDS[placement.value] ?? placement.value}</option>`,
  );
  return html`<h2>Where your files go</h2>
<p class="muted">The machine of yours KoBox copies finished downloads to — a NAS,
a home server, anything that accepts an SSH connection. Each folder above lands
in a folder of the same name over there.</p>
<section class="panel">
  ${verdict(destination)}
  <form method="post" action="/sync/destination">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <div class="facts">
      <label>Address
        <input name="host" value="${destination?.host.value ?? ''}"
          placeholder="nas.example.org" maxlength="253" required></label>
      <label>Port
        <input name="port" type="number" min="1" max="65535"
          value="${String(destination?.port.value ?? 22)}" required></label>
      <label>Account there
        <input name="account" value="${destination?.account.value ?? ''}"
          placeholder="seedbox" maxlength="64" required></label>
      <label>Password
        <input name="password" type="password" maxlength="256"
          placeholder="${destination === undefined ? '' : 'leave empty to keep the current one'}"
          ${destination === undefined ? html`required` : html``}></label>
      <label>Folder there
        <input name="path" value="${destination?.path.value ?? ''}"
          placeholder="/volume1/torrents" maxlength="512" required></label>
      <label>Files per pass
        <input name="batchSize" type="number" min="0" max="1000"
          value="${String(destination?.batchSize.value ?? 0)}" required></label>
      <label>A download that is one single file
        <select name="placement">${placements}</select></label>
    </div>
    <button type="submit">Save</button>
  </form>
  <p class="muted">0 files per pass means "everything waiting". Your password is
  sealed with this box's key the moment you save it: it is never stored in a form
  you can read back, and never appears in a command line.</p>
</section>
${destination === undefined
    ? html``
    : html`<form class="inline" method="post" action="/sync/destination/test">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <button class="ghost" type="submit">Test it now</button>
</form>
<p class="muted">Connects, then checks the folder can be written to. Takes a few
seconds — reload the page for the answer.</p>`}`;
}
