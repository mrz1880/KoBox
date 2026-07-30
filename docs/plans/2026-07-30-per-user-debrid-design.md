# Per-user debrid accounts — design

**Status:** validated 2026-07-30. Supersedes the instance-wide
`KOBOX_ALLDEBRID_APIKEY` introduced with DDL v1 (PR #15).

## Why

Each user brings their own AllDebrid account instead of sharing one server-wide
key: personal quota, no account sharing, and one less secret in `worker.env`.

Having an account is **never a prerequisite**. A user without a key simply has no
DDL — every other KoBox feature is untouched, and only their own download rows
fail, with an actionable message.

The instance key is removed outright rather than kept as a fallback. Nothing to
migrate: DDL merged the same day and the production cutover has never run, so no
deployment relies on it. Sharing one account across users would also burn the
owner's quota and sits outside AllDebrid's terms.

## Storage and encryption

`kobox install` generates an RSA-4096 pair, **idempotently** — regenerating it
would silently invalidate every stored key:

- `/etc/kobox/debrid-pub.pem` — `0644`, readable by the portal
- `/etc/kobox/debrid-key.pem` — `0600 root:root`, readable by the worker only

The portal encrypts a submitted key with the public half (`crypto.publicEncrypt`,
OAEP/SHA-256 — Node built-in, no `openssl` subprocess). The worker decrypts with
the private half at call time. An AllDebrid key is ~32 characters, so it fits in
a single RSA block: **no hybrid AES envelope**, and none of its complexity.

The ciphertext lives in the database. The portal can read that table (it shares
the DB through the `kobox-portal` group) but holds only the public half, so the
blob is inert to it. This preserves the PR #16 invariant: **no usable secret
outside the root worker.**

## Data flow

The portal stores nothing itself — it enqueues a typed job carrying only
ciphertext, and the root worker writes the row. Consistent with "every mutation
enqueues a typed job", and it leaves an audit trail.

```
portal /downloads         → DebridApiKey.parse → encrypt(pub)
                          → job set-debrid-key { username, encryptedKey }
root worker               → debrid_accounts upsert
download start (worker)   → read row → decrypt(priv) → AllDebrid unlock
```

## Ports

The key becomes a per-call parameter, since it now depends on the user:

```ts
DebridPort.unlock(link, apiKey)              // was unlock(link)
DebridCredentialsPort.forUser(username)      // row lookup + decrypt
DebridKeyEncryptorPort.encrypt(key)          // portal side (public half)
DebridKeyDecryptorPort.decrypt(sealed)       // worker side (private half)
```

Encryptor and decryptor are **separate interfaces on purpose**: the type system
then shows the portal can never reach the private half. One adapter implements
both and reads each PEM lazily, so the portal never opens the private file.

`DebridApiKey` is an opaque VO mirroring `Password`: private constructor,
`reveal()` as the only way out, `toString`/`toJSON` returning `[redacted]` so it
cannot leak through a log line or a serialized error.

`StartDebridDownload` gains `DebridCredentialsPort`. With no key it fails the row
with "no AllDebrid account configured — add your key in Downloads" without ever
calling the API.

## Schema

Migration `0009_ddl-per-user-debrid.sql` (drizzle-kit generated):

```
debrid_accounts
  username       text PK       -- one key per user, no history
  encrypted_key  text NOT NULL -- base64 RSA-OAEP, inert to the portal
  updated_at     text NOT NULL
```

`username` as primary key: setting a key **replaces** the previous one
(`ON CONFLICT DO UPDATE`), so stale secrets never accumulate. Clearing a key
deletes the row.

## Lifecycle seams

Where a feature like this leaves residue:

- **`delete-user`** drops the `debrid_accounts` row with the rest of the account.
- **Backup** must include `/etc/kobox/debrid-key.pem`; without it a restore
  leaves every stored key undecryptable (users re-enter them — no other damage).
- **Key generation** stays idempotent: existing PEMs are never overwritten.

## Portal

`/downloads` gains a "My AllDebrid account" panel: a masked field, a save button,
a clear action, and a readable state (configured / missing). The form never
echoes the key back, not even encrypted.

## Testing

- **unit** — `DebridApiKey` redaction and parsing.
- **integration** — RSA encrypt/decrypt round-trip; `SqliteDebridAccountRepository`.
- **component** — download start with and without a key; portal set/clear routes,
  including that the key never appears in the rendered page or the job payload.
- **e2e** — the DDL suite switches to a per-user encrypted key, exercising
  portal → job → worker → decrypt → API end to end.
