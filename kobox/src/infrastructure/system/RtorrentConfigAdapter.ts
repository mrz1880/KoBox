import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RenderedFile, RtorrentConfigPort } from '../../domain/torrent/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// Applies rendered files idempotently: a file is rewritten only when its
// content differs, and nothing outside the given list is ever touched —
// user drop-ins survive every render (the anti-§5.2 guarantee).
//
// The reconciled state is CONTENT. Ownership/mode are (re)set only when a file
// is written: these files are root-owned and 0640, which the seedbox user
// cannot alter, so metadata drift would require manual root action. If that
// ever becomes a real concern, reconcile mode/owner here against a stat.
export class RtorrentConfigAdapter implements RtorrentConfigPort {
  constructor(private readonly runner: CommandRunner) {}

  // mkdir alone leaves a new directory root:root under the process umask, so a
  // file written 0640 root:<member> sat inside a directory its owner could not
  // enter. rtorrent then crash-looped on "could not open ip filter file" the
  // first time it restarted after a blocklist run, with the file itself
  // perfectly readable.
  //
  // Only directories this call creates. An existing one belongs to whoever made
  // it: taking ownership of a member's home, which is the parent of their
  // .rtorrent.rc, locks them out of it and stops nginx traversing to their
  // media. A box already in the broken state is repaired by hand, once.
  private async ensureParentDir(file: RenderedFile): Promise<void> {
    const dir = dirname(file.path);
    if (existsSync(dir)) {
      return; // a home, a config.d, /etc/kobox: someone else owns their mode
    }
    mkdirSync(dir, { recursive: true });
    if (file.group === 'root') {
      return; // /etc/kobox and friends: widening these would be the opposite fix
    }
    await runOrThrow(this.runner, { command: 'chown', args: [`root:${file.group}`, dir] });
    await runOrThrow(this.runner, { command: 'chmod', args: ['0750', dir] });
  }

  async apply(files: readonly RenderedFile[]): Promise<readonly string[]> {
    const changed: string[] = [];
    for (const file of files) {
      const existing = existsSync(file.path) ? readFileSync(file.path, 'utf8') : undefined;
      if (existing === file.content) {
        continue;
      }
      await this.ensureParentDir(file);
      const temp = `${file.path}.kobox-tmp`;
      // born with the final mode: secrets (sasl_passwd) must never sit
      // world-readable between write and the chmod below
      writeFileSync(temp, file.content, { mode: parseInt(file.mode, 8) });
      chmodSync(temp, parseInt(file.mode, 8)); // umask-proof
      renameSync(temp, file.path);
      await runOrThrow(this.runner, {
        command: 'chown',
        args: [`${file.owner}:${file.group}`, file.path],
      });
      await runOrThrow(this.runner, { command: 'chmod', args: [file.mode, file.path] });
      changed.push(file.path);
    }
    return changed;
  }
}
