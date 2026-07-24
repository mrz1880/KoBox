import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RtorrentTemplates } from '../../domain/torrent/rendering.js';

const TEMPLATES_DIR = new URL('../../../templates/rtorrent/', import.meta.url);

function load(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, TEMPLATES_DIR)), 'utf8');
}

// Loaded once at composition time; the domain rendering module only ever
// sees template strings, never the filesystem.
export function loadRtorrentTemplates(): RtorrentTemplates {
  return {
    rtorrentRc: load('rtorrent.rc.tmpl'),
    watchRc: load('80-watch.rc.tmpl'),
    eventShim: load('event-shim.sh.tmpl'),
    systemdUnit: load('rtorrent-user.service.tmpl'),
  };
}
