import { html } from '../html.js';
import { flash, page, type Reader } from './layout.js';

export function loginPage(reader: Reader, error?: string): string {
  return page(
    'Sign in',
    html`<h1>${reader.t('Sign in')}</h1>
${flash(error === undefined ? undefined : reader.t(error), 'error')}
<form class="card" method="post" action="/login">
  <label for="username">${reader.t('Username')}</label>
  <input id="username" name="username" autocomplete="username" autofocus required>
  <label for="password">${reader.t('Password')}</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">${reader.t('Sign in')}</button>
</form>
<p class="muted"><a href="/forgot-password">${reader.t('Forgot your password?')}</a></p>`,
    reader,
  );
}

// The second half of signing in. No CSRF field: the session it completes is
// one that opens nothing else, and the code itself is the proof.
export function twoStepCodePage(reader: Reader, error?: string): string {
  return page(
    'Sign in',
    html`<h1>${reader.t('Your code')}</h1>
${flash(error === undefined ? undefined : reader.t(error), 'error')}
<form class="card" method="post" action="/login/code">
  <label for="code">${reader.t('The 6-digit code from your authenticator app')}</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
    pattern="[0-9]{6}" maxlength="6" autofocus required>
  <button type="submit">${reader.t('Sign in')}</button>
</form>
<form method="post" action="/logout/pending"><button class="ghost" type="submit">${reader.t('Cancel')}</button></form>`,
    reader,
  );
}
