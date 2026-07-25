import type { Role } from '../../../domain/portal/Role.js';
import { html, raw, type RawHtml } from '../html.js';

// One sober stylesheet, no build step, no external assets. Light/dark via
// prefers-color-scheme; mono for telemetry values (UI-AUDIT direction).
const STYLES = `
:root {
  --bg: #efebe2; --panel: #fbfaf6; --line: #d8d2c4; --ink: #1b242e;
  --muted: #5c6672; --teal: #0e8fa6; --amber: #b26f14; --danger: #a33338;
  --green: #2f7d54;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e131a; --panel: #151d28; --line: #26313f; --ink: #e8edf3;
    --muted: #93a1b1; --teal: #37b0c4; --amber: #eba23c; --danger: #e4575c;
    --green: #5fb98a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 system-ui, sans-serif;
}
a { color: var(--teal); }
header {
  display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; align-items: baseline;
  padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--line);
  background: var(--panel);
}
header .brand { font-weight: 700; letter-spacing: 0.08em; }
header nav { display: flex; flex-wrap: wrap; gap: 1rem; }
header nav a { text-decoration: none; color: var(--muted); }
header nav a:hover, header nav a:focus { color: var(--teal); }
header form { margin-left: auto; }
main { max-width: 72rem; margin: 0 auto; padding: 1.25rem; }
h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
table { border-collapse: collapse; width: 100%; background: var(--panel); }
th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.06em; }
td.num, td.mono { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
form.card, div.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 1rem 1.25rem; margin: 1rem 0; max-width: 34rem;
}
label { display: block; margin: 0.6rem 0 0.15rem; color: var(--muted); font-size: 0.85rem; }
input, select {
  width: 100%; padding: 0.45rem 0.6rem; border: 1px solid var(--line);
  border-radius: 4px; background: var(--bg); color: var(--ink); font: inherit;
}
button {
  margin-top: 0.9rem; padding: 0.45rem 1.1rem; border: 1px solid var(--teal);
  border-radius: 4px; background: var(--teal); color: #fff; font: inherit; cursor: pointer;
}
button.ghost { background: transparent; color: var(--teal); }
button.danger { background: var(--danger); border-color: var(--danger); }
form.inline { display: inline; } form.inline button { margin: 0; padding: 0.2rem 0.7rem; font-size: 0.85rem; }
.flash { border-left: 3px solid var(--green); background: var(--panel); padding: 0.6rem 1rem; margin: 1rem 0; }
.error { border-left-color: var(--danger); }
.chip { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.78rem; border: 1px solid var(--line); }
.chip.ok { color: var(--green); border-color: var(--green); }
.chip.warn { color: var(--amber); border-color: var(--amber); }
.chip.bad { color: var(--danger); border-color: var(--danger); }
iframe.app { width: 100%; height: calc(100vh - 8rem); border: 1px solid var(--line); border-radius: 6px; background: #fff; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

export interface Viewer {
  readonly username: string;
  readonly role: Role;
  readonly csrfToken: string;
}

const ADMIN_NAV: readonly (readonly [string, string])[] = [
  ['/', 'Overview'],
  ['/admin/users', 'Users'],
  ['/admin/trackers', 'Trackers'],
  ['/admin/blocklists', 'Blocklists'],
  ['/admin/addresses', 'Addresses'],
  ['/admin/fair-use', 'Fair use'],
  ['/admin/health', 'Health'],
  ['/admin/mails', 'Mails'],
  ['/rutorrent', 'ruTorrent'],
];

const USER_NAV: readonly (readonly [string, string])[] = [
  ['/', 'Home'],
  ['/access', 'My access'],
  ['/password', 'Password'],
  ['/rutorrent', 'ruTorrent'],
];

export function page(title: string, body: RawHtml, viewer?: Viewer): string {
  const nav = viewer === undefined ? [] : viewer.role === 'admin' ? ADMIN_NAV : USER_NAV;
  const document = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — KoBox</title>
<style>${raw(STYLES)}</style>
</head>
<body>
<header>
  <span class="brand">KOBOX</span>
  ${viewer === undefined
    ? undefined
    : html`<nav>${nav.map(([href, label]) => html`<a href="${href}">${label}</a>`)}</nav>
  <form class="inline" method="post" action="/logout">
    <input type="hidden" name="_csrf" value="${viewer.csrfToken}">
    <button class="ghost" type="submit">Sign out (${viewer.username})</button>
  </form>`}
</header>
<main>
${body}
</main>
</body>
</html>
`;
  return document.value;
}

export function flash(message: string | undefined, kind: 'ok' | 'error' = 'ok'): RawHtml {
  if (message === undefined || message === '') {
    return raw('');
  }
  return html`<div class="flash${kind === 'error' ? ' error' : ''}">${message}</div>`;
}
