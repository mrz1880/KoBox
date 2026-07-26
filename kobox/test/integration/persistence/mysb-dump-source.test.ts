import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteMysbDumpSource } from '../../../src/infrastructure/persistence/SqliteMysbDumpSource.js';
import { buildDump } from '../../fixtures/migration/buildDump.js';

let dumpDir: string | undefined;

afterEach(() => {
  if (dumpDir !== undefined) {
    rmSync(dumpDir, { recursive: true, force: true });
    dumpDir = undefined;
  }
});

describe('SqliteMysbDumpSource', () => {
  it('should_read_users_with_preserved_ports_and_the_sync_flag', async () => {
    dumpDir = buildDump({
      users: [
        {
          username: 'alice',
          email: 'alice@example.org',
          scgiPort: 51101,
          rtorrentPort: 45000,
          syncMode: [0, 0],
        },
        {
          username: 'bob',
          email: 'bob@example.org',
          scgiPort: 51102,
          rtorrentPort: 45001,
          syncMode: [2, 0],
        },
        { username: 'carol', email: 'carol@example.org', scgiPort: 51103, rtorrentPort: 45002 },
      ],
    });
    const source = new SqliteMysbDumpSource(dumpDir);

    const users = await source.users();
    source.close();

    expect(users).toHaveLength(3);
    const alice = users.find((u) => u.username === 'alice');
    expect(alice?.scgiPort).toBe(51101);
    expect(alice?.rtorrentPort).toBe(45000);
    expect(alice?.proxyPort).toBe(8080);
    // every category disabled -> the user is not syncing
    expect(alice?.syncDisabled).toBe(true);
    // one category still syncs -> not disabled
    expect(users.find((u) => u.username === 'bob')?.syncDisabled).toBe(false);
    // no sync sqlite at all -> default false
    expect(users.find((u) => u.username === 'carol')?.syncDisabled).toBe(false);
  });

  it('should_group_tracker_ipv4_rows_by_host', async () => {
    dumpDir = buildDump({
      users: [],
      trackers: [
        {
          host: 'tracker.example.org',
          proto: 'https',
          port: 443,
          privacy: 'private',
          ipv4: ['192.0.2.10', '192.0.2.11'],
        },
        { host: 'open.example.net', proto: 'http', port: 80, privacy: 'public' },
      ],
    });
    const source = new SqliteMysbDumpSource(dumpDir);

    const trackers = await source.trackers();
    source.close();

    const priv = trackers.find((t) => t.host === 'tracker.example.org');
    expect(priv?.ipv4).toEqual(['192.0.2.10', '192.0.2.11']);
    expect(priv?.privacy).toBe('private');
    expect(trackers.find((t) => t.host === 'open.example.net')?.ipv4).toEqual([]);
  });

  it('should_read_blocklists_torrents_and_addresses', async () => {
    dumpDir = buildDump({
      users: [
        { username: 'alice', email: 'alice@example.org', scgiPort: 51101, rtorrentPort: 45000 },
      ],
      blocklists: [
        {
          source: 'iblocklist',
          author: 'level1',
          name: 'Level 1',
          url: 'https://lists.example.net/level1.gz',
        },
      ],
      torrents: [
        {
          username: 'alice',
          infoHash: 'a'.repeat(40),
          name: 'Some.Neutral.Release',
          label: 'movies',
          state: 'completed',
        },
      ],
      addresses: [
        { username: 'alice', value: '192.0.2.50', kind: 'ipv4' },
        { username: 'alice', value: 'dyn.example.org', kind: 'hostname' },
      ],
    });
    const source = new SqliteMysbDumpSource(dumpDir);

    const [blocklists, torrents, addresses] = await Promise.all([
      source.blocklists(),
      source.torrents(),
      source.addresses(),
    ]);
    source.close();

    expect(blocklists[0]?.name).toBe('Level 1');
    expect(torrents[0]?.infoHash).toBe('A'.repeat(40));
    expect(torrents[0]?.label).toBe('movies');
    expect(addresses).toHaveLength(2);
    expect(addresses.find((a) => a.kind === 'hostname')?.value).toBe('dyn.example.org');
  });

  it('should_throw_when_the_dump_database_is_missing', () => {
    expect(() => new SqliteMysbDumpSource('/nonexistent/dump/dir')).toThrow();
  });
});
