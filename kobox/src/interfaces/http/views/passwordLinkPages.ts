import { html } from '../html.js';
import { flash, page, type Viewer } from './layout.js';

// The pages a member reaches before they can sign in: no session, no viewer,
// in the same language as the sign-in page.

export function forgotPasswordPage(): string {
  return page(
    'Forgot your password?',
    html`<h1>Forgot your password?</h1>
<form class="card" method="post" action="/forgot-password">
  <label for="identifier">Username or email address</label>
  <input id="identifier" name="identifier" autocomplete="username" autofocus required>
  <button type="submit">Send me a link</button>
</form>
<p class="muted"><a href="/login">Back to sign in</a></p>`,
  );
}

// The same words whoever asked: the page never tells whether an account exists.
export function forgotPasswordSentPage(): string {
  return page(
    'Check your mailbox',
    html`<h1>Check your mailbox</h1>
<p>If an account matches, a link to choose a new password is on its way. It works once and for one hour.</p>
<p class="muted"><a href="/login">Back to sign in</a></p>`,
  );
}

export function choosePasswordPage(action: string, error?: string): string {
  return page(
    'Choose your password',
    html`<h1>Choose your password</h1>
${flash(error, 'error')}
<form class="card" method="post" action="${action}">
  <label for="password">New password</label>
  <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="100" autofocus required>
  <label for="confirm">The same again</label>
  <input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="100" required>
  <button type="submit">Save my password</button>
</form>
<p class="muted">It opens the portal, Nextcloud and the network share.</p>`,
  );
}

export function passwordChosenPage(): string {
  return page(
    'Password saved',
    html`<h1>Password saved</h1>
<p>It takes effect everywhere within a few seconds.</p>
<p><a href="/login">Sign in</a></p>`,
  );
}

// Unknown, expired or used: one page, which never says which.
export function passwordLinkClosedPage(): string {
  return page(
    'This link no longer works',
    html`<h1>This link no longer works</h1>
<p>Ask for a new one, it only takes a moment.</p>
<p><a href="/forgot-password">Get a new link</a></p>`,
  );
}

// Shown once to the admin who invited someone, to pass the link on another way
// if the mail takes its time.
export function invitationLinkPage(username: string, url: string, viewer: Viewer): string {
  return page(
    'Invitation sent',
    html`<h1>Invitation sent to ${username}</h1>
<p>The mail is on its way. You can also pass the link on yourself; it works once and for 7 days.</p>
<p class="mono" id="invitation-link">${url}</p>
<button type="button" onclick="navigator.clipboard.writeText(document.getElementById('invitation-link').textContent)">Copy the link</button>
<p class="muted"><a href="/admin/users/${username}">Back to ${username}</a></p>`,
    viewer,
  );
}
