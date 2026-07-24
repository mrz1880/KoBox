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

  // Malformed files are removed (they will never parse); an owner that cannot
  // be resolved is left in place so a transient getent failure retries next
  // sweep instead of silently dropping a legitimate event.
  private async consume(path: string): Promise<SpooledTorrentEvent | undefined> {
    let uid: number;
    let raw: unknown;
    try {
      uid = statSync(path).uid;
      raw = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof raw !== 'object' || raw === null) {
        throw new Error('event payload is not an object');
      }
    } catch {
      rmSync(path, { force: true }); // unparseable: quarantine by removal
      return undefined;
    }
    const username = await this.resolveUsername(uid);
    if (username === undefined) {
      return undefined; // keep the file for a later sweep
    }
    rmSync(path, { force: true });
    // file owner is authoritative — any username in the payload is discarded
    return { username, payload: { ...(raw as Record<string, unknown>), username } };
  }
}

// uid -> username through getent (argv only). Positive results are cached for
// the process lifetime; negatives are NOT cached, so a transient failure does
// not poison the resolver for a real user.
export class GetentUsernameResolver {
  private readonly cache = new Map<number, string>();

  constructor(private readonly runner: CommandRunner) {}

  resolve: UsernameResolver = async (uid) => {
    const cached = this.cache.get(uid);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.runner.run({ command: 'getent', args: ['passwd', String(uid)] });
    const username = result.exitCode === 0 ? result.stdout.split(':')[0]?.trim() : undefined;
    if (username === undefined || username === '') {
      return undefined;
    }
    this.cache.set(uid, username);
    return username;
  };
}
