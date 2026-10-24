# Password links: invitations and forgotten passwords

Validated design, 2026-10-24. Implementation waits for an end-to-end check of the
existing flow with a real member account.

## Decisions

- An invitation creates the whole account at once (system account, rTorrent,
  VPN), without a password: the system account stays locked, Samba and Nextcloud
  are not created, the portal login holds the role but no password hash and
  refuses to sign in.
- One mechanism serves both needs: a password link, either an invitation or a
  reset. The member chooses their password through it; the existing
  change-password job then applies it everywhere.
- The portal no longer lets an admin type a member's password. `kobox
  create-user` keeps its stdin password as the operator's fallback.
- The invitation link is also shown once to the admin, with a copy button, so it
  can travel another way. A reset link only ever goes by mail.

## Model

`PasswordLink`: member, purpose (invitation or reset), hash of a 32-byte random
token (the token itself is never stored), expiry (7 days for an invitation,
1 hour for a reset), used-at. Single use; refused once expired; issuing a new
link for a member revokes the previous one. The portal credential's password
hash becomes optional (nullable column, one migration).

Opening `/password-link/<token>` only shows the form, so a mail scanner that
prefetches the URL cannot burn it. Submitting consumes the link, enqueues
`change-password` with the sealed password, and redirects to sign-in.

## Flows

- Admin creates a member with username, email, quota and role: `create-user` is
  enqueued and the invitation mailed; the confirmation page shows the link once.
- The member page shows the state (invited until..., invitation expired, active)
  and offers "Resend the invitation" or "Send a reset link".
- "Forgot your password?" on the sign-in page takes a username or an email and
  always answers the same way. At most 3 links per member per hour, requests
  counted per IP like failed sign-ins, nothing for a suspended member.
- Mails carry no password, only the link and how long it lasts, in the member's
  language (French by default). The link uses the public domain from the site
  settings and the portal port, or the hostname when no domain is set. The
  worker's old welcome mail goes, the invitation replaces it.

## Architecture

Domain: `PasswordLink` with an injected clock and token source. Application:
`InviteMember`, `SendPasswordLink`, `RequestPasswordReset`,
`SetPasswordFromLink`, all running in the non-root portal (links, outbox, jobs;
never the system). Persistence: `password_links` table with a unique token hash.
Deleting a member deletes their links; changing a password revokes the open one.

An unknown, expired or used link shows one page, "this link no longer works",
with a way to ask for a new one, without saying which case it was.

## Tests

Domain unit tests (expiry, single use, revocation); component tests for the four
use cases; portal route tests (identical answers, limits); SQLite repository and
migration integration tests; one E2E: invite, set the password through the link
via the real worker, Samba holds the member.

## Afterwards

The 8 existing members get a reset link each instead of a distributed password.
