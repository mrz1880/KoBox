import type { SiteSettings } from '../../../domain/installation/ports.js';
import { html } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

// Saving a name issues nothing. Let's Encrypt needs the name to resolve to this
// machine and a component run to request the certificate, so the page says what
// is stored and what still has to happen rather than implying it is done.
export function adminDomainPage(
  settings: SiteSettings | undefined,
  viewer: Viewer,
  message?: string,
  error?: string,
): string {
  return page(
    'Domain',
    html`<h1>${viewer.t('Domain and certificate')}</h1>
${flash(message)}
${flash(error, 'error')}
<p class="muted">Out of the box this machine serves its pages under a certificate
it signed itself, which every browser refuses loudly. Give it a public name that
points here and it can get a real certificate from Let's Encrypt, renewed on its
own from then on.</p>
${settings === undefined
      ? html`<p class="muted">No public name set, so the self-signed certificate stays.</p>`
      : html`<p>Public name <span class="mono">${settings.domain}</span>, certificate
notices to <span class="mono">${settings.email}</span>.</p>`}
<form class="card" method="post" action="/admin/domain">
  <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
  <label for="domain">${viewer.t('Public name')}</label>
  <input id="domain" name="domain" required placeholder="seedbox.example.org"
    value="${settings?.domain ?? ''}">
  <label for="email">${viewer.t('Where certificate notices go')}</label>
  <input id="email" name="email" type="email" required value="${settings?.email ?? ''}">
  <button type="submit">${viewer.t('Save')}</button>
</form>
<p class="muted">Two things have to be true before a certificate can be issued:
the name must already resolve to this machine, and someone must run
<span class="mono">kobox install</span> on it. Saving here does neither. The
renewal afterwards is automatic and needs nobody.</p>`,
    viewer,
  );
}
