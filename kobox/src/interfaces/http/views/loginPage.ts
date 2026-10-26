import { html } from '../html.js';
import { flash, page } from './layout.js';

export function loginPage(error?: string): string {
  return page(
    'Sign in',
    html`<h1>Sign in</h1>
${flash(error, 'error')}
<form class="card" method="post" action="/login">
  <label for="username">Username</label>
  <input id="username" name="username" autocomplete="username" autofocus required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form>
<p class="muted"><a href="/forgot-password">Forgot your password?</a></p>`,
  );
}

// The second half of signing in. No CSRF field: the session it completes is
// one that opens nothing else, and the code itself is the proof.
export function twoStepCodePage(error?: string): string {
  return page(
    'Sign in',
    html`<h1>Your code</h1>
${flash(error, 'error')}
<form class="card" method="post" action="/login/code">
  <label for="code">The 6-digit code from your authenticator app</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
    pattern="[0-9]{6}" maxlength="6" autofocus required>
  <button type="submit">Sign in</button>
</form>
<form method="post" action="/logout/pending"><button class="ghost" type="submit">Cancel</button></form>`,
  );
}
