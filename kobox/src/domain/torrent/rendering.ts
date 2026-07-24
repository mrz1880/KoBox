import { DomainError } from '../shared/DomainError.js';
import { EventHook } from './EventHook.js';
import { SessionDir } from './SessionDir.js';
import type { TorrentInstance } from './TorrentInstance.js';
import type { WatchDir } from './WatchDir.js';
import type { RenderedFile } from './ports.js';

export class UnresolvedPlaceholderError extends DomainError {
  constructor(names: readonly string[]) {
    super(`unresolved template placeholders: ${names.join(', ')}`);
  }
}

export interface RtorrentTemplates {
  readonly rtorrentRc: string;
  readonly watchRc: string;
  readonly eventShim: string;
  readonly systemdUnit: string;
}

export interface RenderSettings {
  readonly koboxBin: string;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

// Strict on both sides: an unknown placeholder in the template and an unused
// variable both throw — silent template drift is how the legacy regen rotted.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const unused = new Set(Object.keys(vars));
  const missing: string[] = [];
  const rendered = template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      missing.push(name);
      return match;
    }
    unused.delete(name);
    return value;
  });
  if (missing.length > 0 || unused.size > 0) {
    throw new UnresolvedPlaceholderError([...missing, ...unused]);
  }
  return rendered;
}

function homeOf(instance: TorrentInstance): string {
  return `/home/${instance.username.value}`;
}

// Maps each hook's rtorrent argv (EventHook.rtorrentArgs order) onto the
// `kobox torrent-event` CLI flags, positionally: "$1", "$2", ...
const CLI_FLAGS: Record<string, readonly string[]> = {
  inserted_new: ['--hash', '--name', '--directory', '--torrent-file', '--torrent-dir', '--label'],
  finished: ['--hash', '--base-path', '--directory', '--name', '--torrent-file', '--label'],
  erased: ['--hash', '--name', '--directory'],
};

function shimCliArgs(hook: EventHook): string {
  const flags = CLI_FLAGS[hook.type] ?? [];
  return flags.map((flag, index) => `${flag} "$${String(index + 1)}"`).join(' ');
}

function renderRtorrentRc(instance: TorrentInstance, templates: RtorrentTemplates): string {
  const home = homeOf(instance);
  const eventHooks = EventHook.all
    .map(
      (hook) =>
        `method.set_key = ${hook.rcEventKey}, kobox_${hook.type}, ` +
        `"execute2={sh,${home}/${hook.shimFilename},${hook.rtorrentArgs.join(',')}}"`,
    )
    .join('\n');
  return renderTemplate(templates.rtorrentRc, {
    username: instance.username.value,
    home,
    session_dir: SessionDir.forHome(home).value,
    scgi_port: String(instance.scgiPort.value),
    port_range: `${String(instance.rtorrentPort.value)}-${String(instance.rtorrentPort.value)}`,
    event_hooks: eventHooks,
  });
}

function watchSchedule(dir: WatchDir, index: number, home: string): string {
  const label = dir.label?.value ?? '';
  const comment = label === '' ? '# Watching watch/' : `# Watching watch/${label}/`;
  const schedule =
    `schedule2 = watch_directory_${String(index)},5,5,` +
    `"load.normal=${dir.watchPath(home)}/*.torrent,` +
    `d.directory.set=${dir.completePath(home)}/,` +
    `d.custom1.set=${label},` +
    `d.custom2.set=${dir.torrentsPath(home)}/"`;
  return `${comment}\n${schedule}`;
}

function renderWatchRc(instance: TorrentInstance, templates: RtorrentTemplates): string {
  const home = homeOf(instance);
  const schedules = instance.watchDirs
    .map((dir, index) => watchSchedule(dir, index, home))
    .join('\n');
  return renderTemplate(templates.watchRc, {
    username: instance.username.value,
    schedules,
  });
}

function renderShim(
  hook: EventHook,
  templates: RtorrentTemplates,
  settings: RenderSettings,
): string {
  return renderTemplate(templates.eventShim, {
    kobox_bin: settings.koboxBin,
    event_type: hook.type,
    cli_args: shimCliArgs(hook),
  });
}

// The five files KoBox owns inside the user's home. root-owned, group-readable
// by the user: rtorrent reads them, the user cannot edit them (persistent
// customization goes through DB flags or config.d/99-*.rc drop-ins).
export function renderHomeFiles(
  instance: TorrentInstance,
  templates: RtorrentTemplates,
  settings: RenderSettings,
): readonly RenderedFile[] {
  const home = homeOf(instance);
  const owner = 'root';
  const group = instance.username.value;
  return [
    {
      path: `${home}/.rtorrent.rc`,
      content: renderRtorrentRc(instance, templates),
      mode: '0640',
      owner,
      group,
    },
    {
      path: `${home}/rtorrent/config.d/80-watch.rc`,
      content: renderWatchRc(instance, templates),
      mode: '0640',
      owner,
      group,
    },
    ...EventHook.all.map((hook) => ({
      path: `${home}/${hook.shimFilename}`,
      content: renderShim(hook, templates, settings),
      mode: '0750',
      owner,
      group,
    })),
  ];
}

export function renderUnit(instance: TorrentInstance, templates: RtorrentTemplates): string {
  return renderTemplate(templates.systemdUnit, {
    username: instance.username.value,
    home: homeOf(instance),
  });
}
