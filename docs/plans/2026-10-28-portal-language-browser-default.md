# Portal language: member's choice, browser by default — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every page of the portal speaks French or English. A member who has not chosen reads it in their browser's language, and a member can pick French, English or "same as my browser" from their account.

**Architecture:** The French catalogue keyed by English strings (`views/messages.ts`) and the `Viewer.t` seam stay as they are. What changes is how the language is resolved: the member's stored choice comes first, then the browser's `Accept-Language`, then English. Resolution happens at the HTTP boundary (`viewerOf`), because a header is an HTTP concern; the application layer only carries the member's optional choice. Pages without a session (sign-in, password links) get a reader built from the header alone.

**Tech Stack:** TypeScript, Fastify (SSR, no client JS), Vitest (component tests via `server.inject`), SQLite/Drizzle (no schema change: `language` is already nullable).

---

## What exists today (read before starting)

- `src/domain/portal/Language.ts`: `en` | `fr` value object. Its comment argues against the browser header; Task 2 rewrites that comment, since the header now only fills in for a member who never chose.
- `portal_credentials.language` is nullable. `SqlitePortalCredentialsRepository` maps `null` to "no choice".
- `Authenticate.ts:67` collapses "no choice" into `Language.en`: that is where the browser default gets lost.
- `guards.ts` `viewerOf(session)` builds `Viewer { language, t }`. It is called 36 times in the routes.
- `POST /access/language` (`routes/user.ts:1035`) saves `en` or `fr`. **No page renders a form for it anymore**: the keys `Language`, `English` and `French (Français)` sit in the catalogue unused. The selector was lost when the portal was split into two spaces. Members cannot choose today.
- ruTorrent: `GET /rutorrent` sets its `Language` cookie only when the member chose, and clears it otherwise, so ruTorrent then follows the browser. This already matches the new rule; keep it.
- Not translated at all: `loginPage.ts`, `passwordLinkPages.ts` (except `invitationLinkPage`), `syncPage.ts`, `destinationSection.ts`, `transferQueueSection.ts`, `adminConfigPage.ts`, `adminGroups.ts`. Partly translated: `userPages.ts` (e.g. "Restart my rtorrent"). Flash messages (`redirectWithFlash`) are English strings rendered as is.
- Mails: `passwordLinkMail.ts` writes French when the member has no choice. A mail has no browser to ask, so this rule stays.

## Decisions (agreed before implementation)

1. Order: member's choice, then `Accept-Language`, then English.
2. "en" is the code and "English" the label. There is no en-US/en-GB split: `en-US`, `en-GB` and bare `en` all map to `en`.
3. The account offers three options: *Same as my browser* (clears the stored choice), *Français*, *English*.
4. HTML responses send `Vary: Accept-Language`, so no cache serves one member's language to another.
5. Untranslated text renders in English, never as a key: the existing fallback stays.

---

### Task 1: Read the browser's language from `Accept-Language`

**Files:**
- Create: `kobox/src/interfaces/http/browserLanguage.ts`
- Test: `kobox/test/unit/interfaces/http/browser-language.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { Language } from '../../../../src/domain/portal/Language.js';
import { browserLanguage } from '../../../../src/interfaces/http/browserLanguage.js';

describe('browserLanguage', () => {
  it.each([
    ['fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7', Language.fr],
    ['en-US,en;q=0.9,fr;q=0.8', Language.en],
    ['de-DE,de;q=0.9,fr;q=0.5', Language.fr], // first one we speak, by weight
    ['en;q=0.4,fr;q=0.8', Language.fr], // weight beats order
    ['FR', Language.fr],
  ])('should_pick_the_language_the_browser_prefers_among_ours_for_%s', (header, expected) => {
    expect(browserLanguage(header)).toBe(expected);
  });

  it.each([[undefined], [''], ['de-DE,es;q=0.8'], ['*'], ['fr;q=0']])(
    'should_fall_back_to_english_when_the_browser_names_none_of_ours_%s',
    (header) => {
      expect(browserLanguage(header)).toBe(Language.en);
    },
  );
});
```

**Step 2: Run it and watch it fail**

Run: `cd kobox && pnpm vitest run test/unit/interfaces/http/browser-language.test.ts`
Expected: FAIL, module not found.

**Step 3: Minimal implementation**

```ts
import { LANGUAGES, Language, type LanguageValue } from '../../domain/portal/Language.js';

// What a member reads when they never chose: the first language their browser
// asks for that the portal speaks, by the weights it sends, else English.
const FALLBACK = Language.en;

export function browserLanguage(header: string | undefined): Language {
  const ranked = (header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
      return { primary: tag.split('-')[0]?.toLowerCase() ?? '', weight: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.weight > 0 && (LANGUAGES as readonly string[]).includes(entry.primary))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const first = ranked[0];
  return first === undefined ? FALLBACK : Language.parse(first.primary as LanguageValue);
}
```

**Step 4: Run it and watch it pass.** Then `pnpm lint && pnpm typecheck`.

**Step 5: Commit** `feat(portal): read the browser's preferred language`

---

### Task 2: Carry the member's choice, not a resolved language, out of `Authenticate`

**Files:**
- Modify: `kobox/src/application/portal/Authenticate.ts:18,67` (`language: Language` becomes `chosenLanguage: Language | undefined`, and `?? Language.en` goes)
- Modify: `kobox/src/domain/portal/Language.ts` (comment only: a stored choice always wins, and the browser only fills in when there is none)
- Modify: every reader of `session.language`: `grep -rn "session.language\|\.language\b" kobox/src/interfaces kobox/src/application`
- Test: the existing Authenticate component test (`grep -rln "Authenticate" kobox/test/component`)

**Step 1: Failing test.** In the Authenticate test, add `should_leave_the_language_open_for_a_member_who_never_chose`: with stored credentials that have no `language`, expect `session.chosenLanguage` to be `undefined`. Add the twin for a member who chose `fr`.

**Step 2: Run it** and expect a type/assert failure on `chosenLanguage`.

**Step 3: Implement.** Rename the field and fix the compile errors in `guards.ts` `viewerOf` temporarily as `session.chosenLanguage ?? Language.en`. Behavior does not change yet; Task 3 changes it.

**Step 4: Full suite green.** `pnpm test`

**Step 5: Commit** `refactor(portal): keep "no language chosen" apart from English`

---

### Task 3: A member who never chose reads the portal in their browser's language

**Files:**
- Modify: `kobox/src/interfaces/http/guards.ts` (`viewerOf(session, request)` resolves `session.chosenLanguage ?? browserLanguage(request.headers['accept-language'])`)
- Modify: the 36 `viewerOf(session)` call sites in `kobox/src/interfaces/http/routes/*.ts` become `viewerOf(session, request)` (mechanical; `request` is in scope in every handler)
- Test: `kobox/test/component/interfaces/portal-user.test.ts`

**Step 1: Failing tests**

```ts
it('should_speak_the_browsers_language_to_a_member_who_never_chose', async () => {
  const response = await world.server.inject({
    method: 'GET', url: '/', headers: { cookie: user.cookie, 'accept-language': 'fr-FR,fr;q=0.9' },
  });
  expect(response.body).toContain('<html lang="fr">');
  expect(response.body).toContain('Accueil');
});

it('should_keep_a_members_choice_whatever_the_browser_says', async () => {
  await world.server.inject({
    method: 'POST', url: '/access/language',
    headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({ _csrf: user.csrf, language: 'en' }),
  });
  const response = await world.server.inject({
    method: 'GET', url: '/', headers: { cookie: user.cookie, 'accept-language': 'fr' },
  });
  expect(response.body).toContain('<html lang="en">');
});
```

**Step 2: Run it.** The first test fails, because the page is English.

**Step 3: Implement** the `viewerOf` change and update the call sites.

**Step 4: Full suite.** Existing tests that send no header still get English.

**Step 5: Commit** `feat(portal): speak the browser's language until a member chooses`

---

### Task 4: `Vary: Accept-Language` on HTML

**Files:**
- Modify: `kobox/src/interfaces/http/server.ts` (one `onSend` hook: when the content type starts with `text/html`, add `Vary: Accept-Language`)
- Test: `kobox/test/component/interfaces/portal-user.test.ts`

**Step 1: Failing test.** `GET /login` must return a `vary` header that contains `Accept-Language`.
**Steps 2-4:** Run it red, implement, run it green, then run the full suite.
**Step 5: Commit** `fix(portal): tell caches the page depends on the browser's language`

---

### Task 5: "Same as my browser" clears the choice

**Files:**
- Modify: `kobox/src/interfaces/http/routes/user.ts:1033-1055` (schema `z.enum(['browser', 'en', 'fr'])`; `browser` saves the credentials without `language`)
- Check: `SqlitePortalCredentialsRepository.save` writes `null` for a missing language (it does: `credentials.language?.value ?? null`). Add an integration test only if it does not.
- Test: `portal-user.test.ts`

**Step 1: Failing test.** Choose `fr`, then `browser`, then `GET /` with `accept-language: en`: expect `lang="en"`. Also expect the ruTorrent `Language` cookie to be cleared on `GET /rutorrent` (`Max-Age=0`).
**Steps 2-4** as usual.
**Step 5: Commit** `feat(portal): let a member go back to their browser's language`

---

### Task 6: Put the language selector back on the account page

**Files:**
- Modify: `kobox/src/interfaces/http/views/userPages.ts` `accessPage` (a `languageSection(viewer, chosen)` helper: three radios named `language` with values `browser`/`fr`/`en`, the current one `checked`, a CSRF field, and a submit button)
- Modify: `kobox/src/interfaces/http/routes/user.ts` (pass the stored choice to `accessPage` via `AccessFacts.chosenLanguage`)
- Modify: `kobox/src/interfaces/http/views/messages.ts` (add `'Same as my browser': 'Comme mon navigateur'` and `'Save': 'Enregistrer'` if missing; reuse `Language`, `English` and `French (Français)`)
- Test: `portal-user.test.ts`

**Step 1: Failing test.** `GET /access` contains `action="/access/language"`, three `name="language"` inputs, and `value="browser" checked` for a member who never chose.
**Steps 2-4** as usual. Labels show each language in its own name (*Français*, *English*), so someone who cannot read the current page still finds their own.
**Step 5: Commit** `fix(portal): give members back the language selector`

---

### Task 7: Sign-in and password-link pages in the browser's language

**Files:**
- Modify: `kobox/src/interfaces/http/views/layout.ts` (`page()` takes `Viewer | Reader`, where `Reader = { language: Language; t: Translate }` is the part of `Viewer` a page without a session can have; `Viewer` extends `Reader`)
- Modify: `kobox/src/interfaces/http/views/loginPage.ts`, `kobox/src/interfaces/http/views/passwordLinkPages.ts` (each takes a `Reader` and wraps its text in `reader.t(...)`)
- Modify: `kobox/src/interfaces/http/server.ts:153-220`, `kobox/src/interfaces/http/routes/passwordLinks.ts` (build `readerOf(request)` from `browserLanguage`, and add it to `guards.ts` next to `viewerOf`)
- Modify: `messages.ts` (French for every string on these pages, error messages included: `Invalid credentials.`, `That code did not work. Try the current one.`, etc.)
- Test: `portal-user.test.ts` or the auth component test

**Step 1: Failing test.** `GET /login` with `accept-language: fr` contains `<html lang="fr">` and `Se connecter`. A wrong password with the same header returns the French error.
**Steps 2-4** as usual.
**Step 5: Commit** `feat(portal): sign-in and password pages in the browser's language`

---

### Task 8: Flash messages follow the page's language

**Files:**
- Modify: `kobox/src/interfaces/http/views/layout.ts` `flash()` (takes the `Translate` and renders `t(message)`. Keys are fixed server strings, so an unknown one falls back to itself.)
- Modify: the `flash(` call sites (`grep -rn "flash(" kobox/src/interfaces/http/views`)
- Modify: `messages.ts` (French for every `redirectWithFlash(..., '<text>')` string: `grep -rhn "redirectWithFlash(" kobox/src | sed "s/.*, '//"`)
- Test: `portal-user.test.ts` (choose `fr`, post the language form, and expect the `Saved.` flash in French on `/access`)

**Steps 1-5** as usual. **Commit** `feat(portal): flash messages in the member's language`

---

### Task 9: A test that catches a string sent to `t()` with no French

**Files:**
- Test: `kobox/test/unit/interfaces/http/catalogue-completeness.test.ts`
- Modify: `messages.ts` (export `frenchCatalogue()` read-only for the test, or a `hasFrench(english)` check)

**Step 1: Write the test.** Render every page builder exported from `views/*.ts` with a `Viewer` whose `t` records each key, using fixture facts (reuse the builders from `test/unit/interfaces/http/pages.test.ts`). Then assert every recorded key has a French entry. It fails today on keys already passed to `t()` that have no translation, and that failure is the list of work for Task 10.

**Step 2: Run it** and save the list of missing keys.
**Step 3:** Leave it failing on a branch only; it goes green at the end of Task 10. Alternatively, mark the known-missing list as an explicit `KNOWN_GAPS` array in the test that Task 10 shrinks to empty, and delete the array once it is empty.
**Commit** `test(portal): every string sent to the catalogue has its French`

---

### Task 10: Translate the pages still in English

One commit per group, each one shrinking `KNOWN_GAPS`. For each view, wrap the visible text in `viewer.t(...)` and add the French line to `messages.ts`. The completeness test checks the French exists. A component test per group checks one representative string in French (`accept-language: fr`).

1. `userPages.ts` leftovers ("Restart my rtorrent", "Use this if the interface stops responding.", VPN and SFTP texts, etc.)
2. `syncPage.ts`, `destinationSection.ts`, `transferQueueSection.ts` (Folders and sending to a NAS)
3. `adminConfigPage.ts`, `adminGroups.ts`, plus the admin pages' leftovers

Rules: never reflow an English key that is already translated (that would orphan its French). Placeholders go through `{name}`, never concatenation. Technical tokens (ports, paths, commands such as `scp -P`) stay untranslated.

**Commit per group:** `feat(portal): <area> in French`

---

### Task 11: Release and announce

1. Full suite, lint, typecheck; run E2E locally first if `server.ts` changed (`make up && make install`, then `pnpm test:e2e` in the container).
2. PR, wait for every check, merge with rebase, tag, upgrade the box. Use the release script, which aborts if the merge fails.
3. Check in production: `curl -s -H 'Accept-Language: fr' https://<box>/login | grep 'lang="fr"'`, and the same with `en`.
4. WhatsApp announcement in the owner's style, **validated before sending**: the portal now follows the browser's language, and Account offers a choice of French, English or browser.

## Out of scope

- Mails keep their current rule (member's choice, else French): a mail is read without a browser to ask.
- No third language. Adding one means a `LANGUAGES` entry, a catalogue column and a radio button; nothing in this plan blocks that.
- Admin vocabulary decisions (e.g. "fair use", "blocklist") are translated when unambiguous and left in English otherwise, case by case in Task 10.
