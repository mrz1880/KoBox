import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { CommandRunner } from '../system/CommandRunner.js';

// The unprivileged->root seam for rtorrent events. Users drop JSON files into
// a 1733 spool (write-only for others, sticky); the root worker sweeps them
// and derives the username from the FILE OWNER — a payload cannot impersonate
// another user (the legacy world-writable .check_annoncers hole, closed).

export const DEFAULT_SPOOL_DIR = '/var/spool/kobox/events';

export function ensureSpoolDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o1733);
}

export type TorrentEventSubmission = Record<string, string>;

export class TorrentEventSpoolWriter {
  // Monotonic per-process sequence: two submissions in the same millisecond
  // must still sweep in submission order (the timestamp alone cannot).
  private sequence = 0;

  constructor(private readonly dir: string) {}

  submit(submission: TorrentEventSubmission): string {
    this.sequence += 1;
    const name =
      `${String(Date.now()).padStart(15, '0')}-${String(this.sequence).padStart(6, '0')}` +
      `-${randomBytes(4).toString('hex')}.json`;
    const path = join(this.dir, name);
    writeFileSync(`${path}.tmp`, JSON.stringify(submission));
    renameSync(`${path}.tmp`, path); // atomic: the sweeper never sees halves
    return path;
  }
}

export interface SpooledTorrentEvent {
  readonly username: string;
  readonly payload: Record<string, unknown>;
}

export type UsernameResolver = (uid: number) => Promise<string | undefined>;

export class TorrentEventSpoolSweeper {
  constructor(
    private readonly dir: string,
    private readonly resolveUsername: UsernameResolver,
  ) {}

  async sweep(): Promise<readonly SpooledTorrentEvent[]> {
    let names: string[];
    try {
      names = readdirSync(this.dir)
        .filter((name) => name.endsWith('.json'))
        .sort();
    } catch {
      return []; // spool dir not created yet: nothing to sweep
    }
    const events: SpooledTorrentEvent[] = [];
    for (const name of names) {
      const path = join(this.dir, name);
      const event = await this.consume(path);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  // Every visited file is removed: a bad event must not clog the spool.
  private async consume(path: string): Promise<SpooledTorrentEvent | undefined> {
    try {
      const uid = statSync(path).uid;
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const username = await this.resolveUsername(uid);
      if (username === undefined || typeof raw !== 'object' || raw === null) {
        return undefined;
      }
      // file owner is authoritative — any username in the payload is discarded
      return { username, payload: { ...raw, username } };
    } catch {
      return undefined;
    } finally {
      rmSync(path, { force: true });
    }
  }
}

// uid -> username through getent (argv only), cached: the worker resolves
// each active seedbox user once per process lifetime.
export class GetentUsernameResolver {
  private readonly cache = new Map<number, string | undefined>();

  constructor(private readonly runner: CommandRunner) {}

  resolve: UsernameResolver = async (uid) => {
    if (this.cache.has(uid)) {
      return this.cache.get(uid);
    }
    const result = await this.runner.run({ command: 'getent', args: ['passwd', String(uid)] });
    const username = result.exitCode === 0 ? result.stdout.split(':')[0]?.trim() : undefined;
    const resolved = username === '' ? undefined : username;
    this.cache.set(uid, resolved);
    return resolved;
  };
}
