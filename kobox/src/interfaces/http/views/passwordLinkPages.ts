import { html } from '../html.js';
import { flash, page, type Reader, type Viewer } from './layout.js';

// The pages a member reaches before they can sign in: no session, no viewer,
// read in the browser's language like the sign-in page.

export function forgotPasswordPage(reader: Reader): string {
  return page(
    'Forgot your password?',
    html`<h1>${reader.t('Forgot your password?')}</h1>
<form class="card" method="post" action="/forgot-password">
  <label for="identifier">${reader.t('Username or email address')}</label>
  <input id="identifier" name="identifier" autocomplete="username" autofocus required>
  <button type="submit">${reader.t('Send me a link')}</button>
</form>
<p class="muted"><a href="/login">${reader.t('Back to sign in')}</a></p>`,
    reader,
  );
}

// The same words whoever asked: the page never tells whether an account exists.
export function forgotPasswordSentPage(reader: Reader): string {
  return page(
    'Check your mailbox',
    html`<h1>${reader.t('Check your mailbox')}</h1>
<p>${reader.t('If an account matches, a link to choose a new password is on its way. It works once and for one hour.')}</p>
<p class="muted"><a href="/login">${reader.t('Back to sign in')}</a></p>`,
    reader,
  );
}

export function choosePasswordPage(reader: Reader, action: string, error?: string): string {
  return page(
    'Choose your password',
    html`<h1>${reader.t('Choose your password')}</h1>
${flash(reader.t, error, 'error')}
<form class="card" method="post" action="${action}">
  <label for="password">${reader.t('New password')}</label>
  <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="100" autofocus required>
  <label for="confirm">${reader.t('The same again')}</label>
  <input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="100" required>
  <button type="submit">${reader.t('Save my password')}</button>
</form>
<p class="muted">${reader.t('It opens the portal, Nextcloud and the network share.')}</p>`,
    reader,
  );
}

export function passwordChosenPage(reader: Reader): string {
  return page(
    'Password saved',
    html`<h1>${reader.t('Password saved')}</h1>
<p>${reader.t('It takes effect everywhere within a few seconds.')}</p>
<p><a href="/login">${reader.t('Sign in')}</a></p>`,
    reader,
  );
}

// Unknown, expired or used: one page, which never says which.
export function passwordLinkClosedPage(reader: Reader): string {
  return page(
    'This link no longer works',
    html`<h1>${reader.t('This link no longer works')}</h1>
<p>${reader.t('Ask for a new one, it only takes a moment.')}</p>
<p><a href="/forgot-password">${reader.t('Get a new link')}</a></p>`,
    reader,
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
