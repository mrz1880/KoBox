import type { MailRelaySettings } from '../../../application/maintenance/ConfigureMailRelay.js';
import { html } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

// The password is never rendered back, not even masked with its real length:
// the page holds a sealed blob it cannot open, and pretending otherwise would
// be theatre.
export function adminMailPage(
  settings: MailRelaySettings | undefined,
  viewer: Viewer,
  message?: string,
  error?: string,
): string {
  return page(
    'Mail',
    html`<h1>${viewer.t('Mail')}</h1>
${flash(message)}
${flash(error, 'error')}
<p class="muted">KoBox sends mail: a temporary password when you create an account,
a warning when a torrent is removed, a report when a backup fails. Most providers
refuse mail sent straight from a seedbox, so it goes out through a relay you
authenticate against.</p>
${settings === undefined
      ? html`<p class="muted">No relay configured yet, so mail stays queued rather than
being lost.</p>`
      : html`<p>Currently sending through <span class="mono">${settings.host}:${String(settings.port)}</span>
as <span class="mono">${settings.user}</span>.</p>`}
<form class="card" method="post" action="/admin/mail-relay">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="host">${viewer.t('Relay host')}</label>
  <input id="host" name="host" required placeholder="smtp.example.org"
    value="${settings?.host ?? ''}">
  <label for="port">${viewer.t('Port')}</label>
  <input id="port" name="port" type="number" min="1" max="65535"
    value="${String(settings?.port ?? 587)}">
  <label for="user">${viewer.t('Login')}</label>
  <input id="user" name="user" required value="${settings?.user ?? ''}">
  <label for="password">${viewer.t('Password')}</label>
  <input id="password" name="password" type="password" required>
  <p class="muted">The password is sealed with this box's key before it is stored.
It is never shown again, so type it in full each time you change anything here.</p>
  <button type="submit">${viewer.t('Save and apply')}</button>
</form>

<h2>${viewer.t('Does it work?')}</h2>
<form class="card" method="post" action="/admin/mail-relay/test">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <p class="muted">Sends one message to your own address. A relay you have never
tested is a relay you find out about on the day it matters.</p>
  <button type="submit">${viewer.t('Send me a test message')}</button>
</form>`,
    viewer,
  );
}
