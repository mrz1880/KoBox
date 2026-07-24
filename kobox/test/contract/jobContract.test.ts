import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JOB_TYPES, jobPayloadSchemas, parseJob } from '../../src/application/jobs/contract.js';

const HASH = '$6$testsalt$0123456789abcdefghijklmnopqrstuv';

describe('job contract', () => {
  it('should_expose_a_closed_set_of_job_types', () => {
    expect(JOB_TYPES).toEqual([
      'create-user',
      'delete-user',
      'change-password',
      'suspend-user',
      'resume-user',
      'provision-rtorrent',
      'deprovision-rtorrent',
      'render-rtorrent-config',
      'add-watch-dir',
      'set-sync-disabled',
      'set-allow-public-tracker',
      'torrent-event',
    ]);
  });

  it('should_parse_a_valid_create_user_job', () => {
    const job = parseJob('create-user', {
      username: 'alice',
      email: 'alice@example.org',
      accountType: 'normal',
      quotaBytes: 412 * 1024 ** 3,
      proxyPort: 8080,
      passwordHash: HASH,
    });

    expect(job.type).toBe('create-user');
    if (job.type === 'create-user') {
      expect(job.payload.username).toBe('alice');
    }
  });

  it('should_reject_unknown_job_types', () => {
    expect(() => parseJob('rm-rf', { username: 'alice' })).toThrow(/unknown job type/);
  });

  it('should_reject_payloads_violating_domain_invariants', () => {
    expect(() => parseJob('suspend-user', { username: 'Tony Z; rm -rf /' })).toThrow();
    expect(() => parseJob('suspend-user', { username: 'root' })).toThrow();
    expect(() =>
      parseJob('change-password', { username: 'alice', passwordHash: 'plaintext' }),
    ).toThrow();
    expect(() =>
      parseJob('create-user', {
        username: 'alice',
        email: 'not-an-email',
        accountType: 'normal',
        quotaBytes: 1,
        proxyPort: 8080,
        passwordHash: HASH,
      }),
    ).toThrow();
  });

  it('should_parse_torrent_lifecycle_jobs', () => {
    expect(parseJob('provision-rtorrent', { username: 'alice' }).type).toBe('provision-rtorrent');
    expect(parseJob('add-watch-dir', { username: 'alice', label: 'films' }).type).toBe(
      'add-watch-dir',
    );
    expect(parseJob('set-sync-disabled', { username: 'alice', disabled: true }).type).toBe(
      'set-sync-disabled',
    );
    expect(
      parseJob('set-allow-public-tracker', { username: 'alice', allowed: false }).type,
    ).toBe('set-allow-public-tracker');
  });

  it('should_parse_a_torrent_event_with_optional_paths', () => {
    const job = parseJob('torrent-event', {
      username: 'alice',
      event: 'inserted_new',
      infoHash: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
      name: 'debian.iso',
      directory: '/home/alice/rtorrent/complete',
      torrentFile: '/home/alice/rtorrent/torrents/debian.iso.torrent',
      label: 'films',
    });
    expect(job.type).toBe('torrent-event');
    if (job.type === 'torrent-event') {
      expect(job.payload.event).toBe('inserted_new');
    }
    // minimal erased event: hash only
    expect(
      parseJob('torrent-event', {
        username: 'alice',
        event: 'erased',
        infoHash: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
      }).type,
    ).toBe('torrent-event');
  });

  it('should_reject_torrent_event_payloads_violating_invariants', () => {
    const base = {
      username: 'alice',
      event: 'finished',
      infoHash: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
    };
    expect(() => parseJob('torrent-event', { ...base, infoHash: 'nothex' })).toThrow();
    expect(() => parseJob('torrent-event', { ...base, event: 'paused' })).toThrow();
    expect(() =>
      parseJob('torrent-event', { ...base, torrentFile: '../../../etc/shadow' }),
    ).toThrow(); // paths must be absolute without traversal
    expect(() =>
      parseJob('torrent-event', { ...base, torrentFile: '/home/alice/../../etc/x' }),
    ).toThrow();
    expect(() => parseJob('add-watch-dir', { username: 'alice', label: '../up' })).toThrow();
    expect(() => parseJob('add-watch-dir', { username: 'alice', label: 'Films Fr' })).toThrow();
  });

  // Breaking-change detector: if a payload schema changes shape, this snapshot
  // moves and the diff must be acknowledged in review (web<->worker contract).
  it('should_keep_the_wire_contract_stable', () => {
    const shapes = Object.fromEntries(
      JOB_TYPES.map((type) => [type, z.toJSONSchema(jobPayloadSchemas[type])]),
    );
    expect(shapes).toMatchSnapshot();
  });
});
