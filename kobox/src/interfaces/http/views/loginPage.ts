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
</form>`,
  );
}
