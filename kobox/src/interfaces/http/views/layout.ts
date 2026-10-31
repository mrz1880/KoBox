import type { Language } from '../../../domain/portal/Language.js';
import { NETWORK_AND_SECURITY, SYSTEM, TROUBLESHOOTING } from './adminGroups.js';
import type { Translate } from './messages.js';
import type { Role } from '../../../domain/portal/Role.js';
import { html, raw, type RawHtml } from '../html.js';

// One sober stylesheet, no build step, no external assets. Dark only for now;
// mono for telemetry values.
const STYLES = `
:root {
  color-scheme: dark;
  --bg: #0e131a; --panel: #151d28; --raised: #1b2533; --line: #26313f; --ink: #e8edf3;
  --muted: #93a1b1; --teal: #37b0c4; --amber: #eba23c; --danger: #e4575c;
  --green: #5fb98a;
  /* the colour of the space being read: teal for one's seedbox, amber for administration */
  --space: var(--teal);
  --on-accent: #0e131a;
}
body.admin { --space: var(--amber); }
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 system-ui, sans-serif;
}
a { color: var(--teal); }
header {
  display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; align-items: center;
  padding: 0.75rem 1.5rem; border-bottom: 1px solid var(--line); background: var(--panel);
}
header .brand { font-family: ui-monospace, monospace; font-weight: 700; letter-spacing: 0.12em; }
header .spacer { flex: 1; }
/* the two spaces as one segmented switch: which one you are in is never a guess */
nav.spaces { display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); }
nav.spaces a {
  display: inline-flex; align-items: center; min-height: 2.25rem; padding: 0 0.9rem;
  border-radius: 8px; text-decoration: none; color: var(--muted); font-weight: 600;
}
nav.spaces a:hover, nav.spaces a:focus { color: var(--ink); }
nav.spaces a[aria-current="page"] { background: var(--space); color: var(--on-accent); }
.band {
  padding: 0.5rem 1.5rem; font-size: 0.88rem; color: var(--ink);
  background: color-mix(in srgb, var(--amber) 16%, var(--bg));
  border-bottom: 1px solid color-mix(in srgb, var(--amber) 45%, var(--line));
}
.band strong { color: var(--amber); }
/* side menu + content; the menu stacks above the content on a phone */
.shell {
  display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: flex-start;
  max-width: 80rem; margin: 0 auto; padding: 1.5rem;
}
nav.menu { flex: 1 1 13rem; max-width: 16rem; display: flex; flex-direction: column; gap: 0.25rem; }
nav.menu a {
  display: block; padding: 0.55rem 0.85rem; border-radius: 10px; border: 1px solid transparent;
  text-decoration: none; color: var(--ink);
}
nav.menu a .label { display: block; font-weight: 600; }
nav.menu a .hint { display: block; font-size: 0.8rem; color: var(--muted); }
nav.menu a:hover, nav.menu a:focus { background: var(--panel); }
nav.menu a[aria-current="page"] {
  background: var(--panel); border-color: var(--line); box-shadow: inset 3px 0 0 var(--space);
}
main { flex: 999 1 35rem; min-width: 0; }
h1 { font-size: 1.75rem; margin: 0 0 1rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
.lead { color: var(--muted); }
table { border-collapse: collapse; width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
th, td {
  text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--line);
  /* top-aligned: a wrapped cell must not float its neighbours to the middle */
  vertical-align: top;
}
th { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.06em; }
td.num, td.mono { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
/* a word in a figures column ("not measured") stays a word */
td.num .muted { font-family: system-ui, sans-serif; }
/* a row's own button sits at the end, level with what it acts on */
th.act, td.act { text-align: right; width: 1%; white-space: nowrap; }
tr:has(td.act) td { vertical-align: middle; }
.mono { font-family: ui-monospace, monospace; }
tr.current td { background: var(--panel); font-weight: 600; }
/* Diagnostics: a captured excerpt and the panel that frames it. The excerpt
   scrolls inside its own box: a 200-line journal must not stretch the page. */
.panel {
  border: 1px solid var(--line); border-radius: 12px; background: var(--panel);
  padding: 1rem 1.25rem; margin: 0.75rem 0;
}
.panel .eyebrow { display: flex; gap: 0.6rem; align-items: baseline; }
.panel .lead { font-size: 1.05rem; margin: 0.3rem 0 0.6rem; }
.log {
  font-family: ui-monospace, monospace; font-size: 0.78rem; line-height: 1.45;
  max-height: 22rem; overflow: auto; white-space: pre; margin: 0.6rem 0 0;
  padding: 0.7rem; border-radius: 4px; background: var(--bg); border: 1px solid var(--line);
}
/* timestamps claim the width they need instead of breaking mid-value */
td.when {
  white-space: nowrap; width: 1%; font-family: ui-monospace, monospace;
  font-variant-numeric: tabular-nums; font-size: 0.8rem; color: var(--muted);
}
/* file names and links are data, read as mono; a failure is prose, read as text */
.path { font-family: ui-monospace, monospace; font-size: 0.85rem; overflow-wrap: anywhere; }
.reason { color: var(--muted); }
.reason code {
  font-family: ui-monospace, monospace; font-size: 0.78rem; color: var(--danger);
  border: 1px solid var(--line); border-radius: 3px; padding: 0 0.3rem; margin-right: 0.35rem;
}
form.card, div.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 1.1rem 1.25rem; margin: 1rem 0; max-width: 36rem;
}
/* a card's first line sits on its padding, not on a paragraph's margin too */
.card > :first-child, .card > input[type="hidden"]:first-child + * { margin-top: 0; }
/* independent settings share the width on a wide screen, one per row on a phone */
.tiles {
  display: grid; gap: 0 1.5rem; align-items: start;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 24rem), 1fr));
}
.tiles .card { max-width: none; }
label { display: block; margin: 0.6rem 0 0.15rem; color: var(--muted); font-size: 0.85rem; }
/* a checkbox reads as a sentence, not as a field: the box sits with its words
   and must escape the full-width rule below */
label.check { display: flex; align-items: center; gap: 0.5rem; color: var(--ink); font-size: 0.95rem; }
label.check input { width: auto; margin: 0; }
input, select {
  width: 100%; min-height: 2.75rem; padding: 0.45rem 0.75rem; border: 1px solid var(--line);
  border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit;
}
button {
  margin-top: 0.9rem; min-height: 2.75rem; padding: 0.45rem 1.2rem; border: 1px solid var(--teal);
  border-radius: 8px; background: var(--teal); color: var(--on-accent); font: inherit;
  font-weight: 600; cursor: pointer;
}
button.ghost { background: transparent; color: var(--teal); }
button.danger { background: var(--danger); border-color: var(--danger); }
form.inline { display: inline; } form.inline button { margin: 0; min-height: 2.25rem; padding: 0.2rem 0.8rem; font-size: 0.85rem; }
.flash { border-left: 3px solid var(--green); background: var(--panel); border-radius: 8px; padding: 0.7rem 1rem; margin: 1rem 0; }
.error { border-left-color: var(--danger); }
.muted { color: var(--muted); font-size: 0.85rem; }
.links { margin-top: 1.5rem; }

/* A choice, presented as a choice: cards side by side, each carrying the one
   sentence that tells you whether it is the one you want. */
.choices { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); margin: 1rem 0; }
.choice {
  display: flex; flex-direction: column; gap: 0.5rem; min-height: 8rem;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 1.1rem;
}
.choice.pick { border: 2px solid var(--teal); }
.choice h3 { margin: 0; font-size: 1.05rem; }
.choice p { margin: 0; color: var(--muted); font-size: 0.88rem; flex: 1; }
.choice .tag {
  align-self: flex-start; font-size: 0.66rem; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--teal); font-weight: 700;
}
.choice a.action {
  align-self: flex-start; display: inline-flex; align-items: center; min-height: 2.5rem;
  text-decoration: none; font-weight: 600; font-size: 0.9rem;
  border: 1px solid var(--teal); color: var(--teal); border-radius: 8px; padding: 0 0.95rem;
}
.choice a.action:hover, .choice a.action:focus { background: var(--teal); color: var(--bg); }
.facts { display: grid; gap: 0.35rem 1.5rem; grid-template-columns: auto 1fr; margin: 0.5rem 0 0; }
.facts dt { color: var(--muted); font-size: 0.8rem; }
.facts dd {
  margin: 0; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums;
  font-size: 0.85rem; overflow-wrap: anywhere;
}

/* --- Signal strip: the console signature ---------------------------------
   Each user reads as a mixing-desk channel: a state LED, a segmented VU of
   egress against their fair-use budget, then the numbers. Segments (not a
   smooth bar) are the deliberate cue: a bar that runs into the peak zone is
   how an abuser becomes obvious at a glance instead of days later. */
.eyebrow {
  font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted); font-weight: 600;
}
.strip {
  display: grid; gap: 0.25rem 1rem; align-items: center;
  grid-template-columns: auto minmax(6rem, 10rem) 1fr auto;
  padding: 0.75rem 1rem; border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel); margin: 0.4rem 0;
}
.strip + .strip { margin-top: 0.4rem; }
.strip .led {
  width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 22%, transparent);
}
.strip .led.warn { background: var(--amber); box-shadow: 0 0 0 3px color-mix(in srgb, var(--amber) 22%, transparent); }
.strip .led.bad { background: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent); }
.strip .led.off { background: var(--muted); box-shadow: none; }
.strip .who { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.strip .who a, .strip .who .name { font-weight: 700; text-decoration: none; color: var(--ink); }
.strip .who .name { overflow-wrap: anywhere; }
.strip .figures {
  font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums;
  font-size: 0.8rem; color: var(--muted); text-align: right; white-space: nowrap;
}
.strip .figures b { color: var(--ink); font-weight: 600; }
.vu { display: flex; gap: 2px; align-items: flex-end; height: 1.1rem; }
.vu i { flex: 1 1 0; height: 100%; background: var(--line); border-radius: 1px; }
.vu i.on { background: var(--teal); }
.vu i.on.warn { background: var(--amber); }
.vu i.on.peak { background: var(--danger); }
/* the peak zone stays tinted even unlit, so the scale is readable at rest */
.vu i.zone { background: color-mix(in srgb, var(--danger) 18%, var(--line)); }
.ribbon {
  display: flex; flex-wrap: wrap; gap: 0.6rem 2rem; align-items: baseline;
  padding: 1rem 1.25rem; border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel);
}
.ribbon .metric { display: flex; flex-direction: column; gap: 0.15rem; }
.ribbon .metric .val {
  font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums;
  font-size: 1.35rem; font-weight: 600;
}
.ribbon .metric .val.alert { color: var(--amber); }
.ribbon .metric .val.bad { color: var(--danger); }
@media (max-width: 40rem) {
  .strip { grid-template-columns: auto 1fr; }
  .strip .figures { grid-column: 1 / -1; text-align: left; }
  .strip .vu { grid-column: 1 / -1; }
}
.chip { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.78rem; border: 1px solid var(--line); }
.chip.ok { color: var(--green); border-color: var(--green); }
.chip.warn { color: var(--amber); border-color: var(--amber); }
.chip.bad { color: var(--danger); border-color: var(--danger); }
iframe.app { width: 100%; height: calc(100vh - 10rem); border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

// The part of a viewer a page without a session can have: the language it is
// read in, the lookup bound to it, and the time zone of the box's clock.
export interface Reader {
  readonly language: Language;
  readonly t: Translate;
  readonly zone: string;
}

// Every view already receives a Viewer, so its language is the one seam that
// reaches all of them.
export interface Viewer extends Reader {
  readonly username: string;
  readonly role: Role;
  readonly csrfToken: string;
}

function isViewer(reader: Reader): reader is Viewer {
  return 'username' in reader;
}

// Two spaces, never one replacing the other: an admin is a member too, and the
// administration menu used to hide their own files, folders and account.
export type Space = 'seedbox' | 'admin';

// Ordered by how often a person needs it, not by how the system is organised.
// VPN profiles, ports and the password live behind "Account": needed rarely,
// and putting them in the main bar made the technical look mandatory.
// [href, label, the line under it]
type MenuEntry = readonly [string, string, string];

const SEEDBOX_NAV: readonly MenuEntry[] = [
  ['/', 'Home', 'Your seedbox at a glance'],
  ['/rutorrent', 'Torrents', 'ruTorrent'],
  ['/files', 'My files', 'Nextcloud, SFTP, network share'],
  ['/media', 'My media', 'Watch in the browser'],
  ['/sync', 'Folders', 'Your categories'],
  ['/access', 'Account', 'Password, VPN, keys'],
];

// One entry per job an admin comes to do; the pages behind a group are listed
// on that group's page (adminGroups.ts) rather than lined up in the bar.
const ADMIN_NAV: readonly MenuEntry[] = [
  ['/admin', 'Overview', 'What needs you'],
  ['/admin/users', 'Members', 'Invite, quotas, roles'],
  [NETWORK_AND_SECURITY.path, NETWORK_AND_SECURITY.title, NETWORK_AND_SECURITY.hint],
  [SYSTEM.path, SYSTEM.title, SYSTEM.hint],
  ['/admin/health', 'Health', 'Services and monitoring'],
  [TROUBLESHOOTING.path, TROUBLESHOOTING.title, TROUBLESHOOTING.hint],
];

const SPACES: readonly (readonly [string, string])[] = [
  ['/', 'My seedbox'],
  ['/admin', 'Administration'],
];

// Where a page sits when its title is not the label of its menu entry: one
// member's page belongs under Members, and its title names the member.
export interface MenuPlace {
  readonly entry: string;
  readonly titleValues: Readonly<Record<string, string>>;
}

// KoBox's tab icon: a K in the console's green on its panel colour. Carried
// inside every page, so neither nginx nor the portal serves a file for it.
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="14" fill="#151d28"/>' +
  '<rect x="3" y="3" width="58" height="58" rx="12" fill="none" stroke="#26313f" stroke-width="2"/>' +
  '<path d="M21 15v34M43 15L22 32l21 17" fill="none" stroke="#5fb98a" stroke-width="8"' +
  ' stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_LINK = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(ICON_SVG)}">`;

// A reader gets the page in their language; only a signed-in viewer gets the
// menus and the sign-out button.
export function page(
  title: string,
  body: RawHtml,
  reader?: Reader,
  space: Space = 'seedbox',
  place?: MenuPlace,
): string {
  const current = place?.entry ?? title;
  const nav = space === 'admin' ? ADMIN_NAV : SEEDBOX_NAV;
  const viewer = reader !== undefined && isViewer(reader) ? reader : undefined;
  const document = html`<!doctype html>
<html lang="${reader?.language.value ?? 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${reader === undefined ? title : reader.t(title, place?.titleValues)}, KoBox</title>
${raw(ICON_LINK)}
<style>${raw(STYLES)}</style>
</head>
<body${space === 'admin' ? raw(' class="admin"') : undefined}>
<header>
  <span class="brand">KOBOX</span>
  ${viewer === undefined
    ? undefined
    : html`${viewer.role === 'admin'
        ? html`<nav aria-label="Space" class="spaces">${SPACES.map(
            ([href, label]) =>
              html`<a href="${href}"${(href === '/admin') === (space === 'admin') ? raw(' aria-current="page"') : undefined}>${viewer.t(label)}</a>`,
          )}</nav>`
        : undefined}
  <span class="spacer"></span>
  <form class="inline" method="post" action="/logout">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button class="ghost" type="submit">${viewer.t('Sign out')} (${viewer.username})</button>
  </form>`}
</header>
${viewer !== undefined && space === 'admin'
    ? html`<div class="band">${viewer.t('admin.band')}</div>`
    : undefined}
<div class="shell">
${viewer === undefined
    ? undefined
    : html`<nav aria-label="Menu" class="menu">${nav.map(
        ([href, label, hint]) =>
          // the page names itself with its entry's label: that is how the
          // entry being read is found, without the page passing its path
          html`<a href="${href}"${label === current ? raw(' aria-current="page"') : undefined}><span class="label">${viewer.t(label)}</span><span class="hint">${viewer.t(hint)}</span></a>`,
      )}</nav>`}
<main>
${body}
</main>
</div>
</body>
</html>
`;
  return document.value;
}

// A flash is one of the server's own sentences, so it is looked up like any
// other; one arriving from elsewhere (it rides in the query string) matches no
// key, shows as it came, and is escaped like any other text.
// A table with nothing in it says so in one full-width row, rather than
// showing its headers alone like a page that broke.
export function rowsOrEmpty(
  rows: readonly RawHtml[],
  empty: { readonly columns: number; readonly message: string },
  t: Translate,
): RawHtml | readonly RawHtml[] {
  return rows.length > 0
    ? rows
    : html`<tr><td colspan="${String(empty.columns)}" class="muted">${t(empty.message)}</td></tr>`;
}

export function flash(
  t: Translate,
  message: string | undefined,
  kind: 'ok' | 'error' = 'ok',
): RawHtml {
  if (message === undefined || message === '') {
    return raw('');
  }
  return html`<div class="flash${kind === 'error' ? ' error' : ''}">${t(message)}</div>`;
}

// A sentence holding a link or a monospaced value. The sentence is looked up
// and escaped like any text, then each {name} becomes its markup, so a
// translation keeps the markup wherever its own grammar puts it. One pass: a
// value's markup is never scanned for placeholders of its own.
export function sentence(
  t: Translate,
  english: string,
  values: Readonly<Record<string, RawHtml>>,
): RawHtml {
  return raw(
    html`${t(english)}`.value.replace(
      /\{(\w+)\}/g,
      (placeholder, name: string) => values[name]?.value ?? placeholder,
    ),
  );
}
