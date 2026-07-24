import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TorrentEventSpoolSweeper,
  TorrentEventSpoolWriter,
  ensureSpoolDir,
} from '../../../src/infrastructure/spool/TorrentEventSpool.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-spool-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const myUid = process.getuid?.() ?? 0;

function sweeperResolvingTo(username: string | undefined): TorrentEventSpoolSweeper {
  return new TorrentEventSpoolSweeper(dir, (uid) =>
    Promise.resolve(uid === myUid ? username : undefined),
  );
}

const submission = {
  event: 'finished',
  infoHash: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
  name: 'x',
  basePath: '/home/alice/rtorrent/complete/x',
};

describe('torrent event spool', () => {
  it('should_roundtrip_a_submission_stamping_the_file_owner_as_username', async () => {
    new TorrentEventSpoolWriter(dir).submit(submission);

    const events = await sweeperResolvingTo('alice').sweep();

    expect(events).toHaveLength(1);
    expect(events[0]?.username).toBe('alice');
    expect(events[0]?.payload).toMatchObject({ ...submission, username: 'alice' });
    expect(readdirSync(dir)).toHaveLength(0); // consumed
  });

  it('should_override_a_spoofed_username_with_the_file_owner', async () => {
    new TorrentEventSpoolWriter(dir).submit({ ...submission, username: 'root' });

    const events = await sweeperResolvingTo('alice').sweep();

    expect(events[0]?.payload.username).toBe('alice'); // identity = file ownership
  });

  it('should_keep_events_whose_owner_cannot_be_resolved_for_a_later_retry', async () => {
    // A transient getent failure must not silently drop a legitimate event;
    // leave the file so the next sweep can resolve and process it.
    new TorrentEventSpoolWriter(dir).submit(submission);

    const events = await sweeperResolvingTo(undefined).sweep();

    expect(events).toHaveLength(0);
    expect(readdirSync(dir)).toHaveLength(1); // preserved, not consumed
  });

  it('should_quarantine_malformed_json_without_blocking_the_rest', async () => {
    writeFileSync(join(dir, '0000000000-bad.json'), '{not json');
    new TorrentEventSpoolWriter(dir).submit(submission);

    const events = await sweeperResolvingTo('alice').sweep();

    expect(events).toHaveLength(1);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('should_ignore_half_written_tmp_files', async () => {
    writeFileSync(join(dir, '123.json.tmp'), '{"partial":');

    const events = await sweeperResolvingTo('alice').sweep();

    expect(events).toHaveLength(0);
    expect(readdirSync(dir)).toEqual(['123.json.tmp']); // left for its writer
  });

  it('should_sweep_in_submission_order', async () => {
    const writer = new TorrentEventSpoolWriter(dir);
    writer.submit({ ...submission, name: 'first' });
    writer.submit({ ...submission, name: 'second' });

    const events = await sweeperResolvingTo('alice').sweep();

    expect(events.map((event) => event.payload.name)).toEqual(['first', 'second']);
  });

  it('should_create_the_spool_dir_write_only_for_others', () => {
    const spool = join(dir, 'events');
    ensureSpoolDir(spool);
    ensureSpoolDir(spool); // idempotent

    const mode = statSync(spool).mode & 0o7777;
    expect(mode).toBe(0o1733); // sticky, others may write but not list
  });
});
