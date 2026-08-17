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
      'set-user-quota',
      'sample-disk-usage',
      'provision-nextcloud-account',
      'close-nextcloud-account',
      'apply-mail-relay',
      'set-ssh-key',
      'remove-ssh-key',
      'suspend-user',
      'resume-user',
      'provision-rtorrent',
    'restart-rtorrent',
      'deprovision-rtorrent',
      'render-rtorrent-config',
      'add-watch-dir',
    'set-category-sync-mode',
    'check-sync-destination',
    'send-pending-transfers',
    'requeue-transfer',
      'set-sync-disabled',
      'set-allow-public-tracker',
      'set-recycling',
      'torrent-event',
      'discover-tracker',
      'fetch-tracker-cert',
      'renew-tracker-certs',
      'mark-tracker-dead',
      'import-blocklist-catalog',
      'update-blocklists',
      'render-whitelist',
      'render-blocklist-filters',
      'set-blocklist-enabled',
      'add-user-address',
      'remove-user-address',
      'apply-firewall',
      'render-fail2ban',
      'add-user-hostname',
      'remove-user-hostname',
      'resolve-dyndns',
      'render-openvpn',
      'provision-vpn-user',
      'deprovision-vpn-user',
      'evaluate-fair-use',
      'send-mails',
      'run-backup',
    'run-speedtest',
    'restart-service',
    'capture-service-log',
    'check-package-updates',
    'apply-package-updates',
    'index-media',
      'apply-ipset',
      'set-fair-use-override',
      'render-rutorrent-users',
      'render-nfs-exports',
      'debrid-download',
      'poll-debrid-downloads',
    'set-debrid-key',
    'clear-debrid-key',
    ]);
  });

  it('should_default_create_user_role_to_user_and_accept_admin', () => {
    const payload = {
      username: 'alice',
      email: 'alice@example.org',
      accountType: 'normal',
      quotaBytes: 1,
      proxyPort: 8080,
      passwordHash: HASH,
    };

    const plain = parseJob('create-user', payload);
    const admin = parseJob('create-user', { ...payload, role: 'admin' });

    if (plain.type === 'create-user' && admin.type === 'create-user') {
      expect(plain.payload.role).toBe('user');
      expect(admin.payload.role).toBe('admin');
    }
    expect(() => parseJob('create-user', { ...payload, role: 'superuser' })).toThrow();
  });

  it('should_parse_fair_use_override_jobs_with_nullable_clears', () => {
    const set = parseJob('set-fair-use-override', {
      username: 'alice',
      egressLimitBps: 10_000_000,
      throttleToBps: null,
    });

    expect(set.type).toBe('set-fair-use-override');
    if (set.type === 'set-fair-use-override') {
      expect(set.payload.egressLimitBps).toBe(10_000_000);
      expect(set.payload.throttleToBps).toBeNull();
      expect(set.payload.authRatePerHour).toBeUndefined();
    }
    expect(() =>
      parseJob('set-fair-use-override', { username: 'alice', egressLimitBps: -1 }),
    ).toThrow();
    expect(() => parseJob('set-fair-use-override', { username: 'alice', extra: 1 })).toThrow();
  });

  it('should_parse_portal_phase_render_jobs', () => {
    expect(parseJob('render-rutorrent-users', {}).type).toBe('render-rutorrent-users');
    expect(parseJob('render-nfs-exports', {}).type).toBe('render-nfs-exports');
    expect(() => parseJob('render-rutorrent-users', { extra: 1 })).toThrow();
  });

  it('should_parse_maintenance_jobs', () => {
    expect(parseJob('send-mails', {}).type).toBe('send-mails');
    expect(parseJob('run-backup', {}).type).toBe('run-backup');
    expect(parseJob('apply-ipset', {}).type).toBe('apply-ipset');
    expect(() => parseJob('send-mails', { extra: 1 })).toThrow(); // strict object
    expect(() => parseJob('run-backup', { extra: 1 })).toThrow();
  });

  it('should_parse_security_jobs', () => {
    expect(parseJob('apply-firewall', {}).type).toBe('apply-firewall');
    expect(() => parseJob('apply-firewall', { extra: 1 })).toThrow(); // strict object
    expect(parseJob('render-fail2ban', {}).type).toBe('render-fail2ban');
    expect(parseJob('resolve-dyndns', {}).type).toBe('resolve-dyndns');
    expect(
      parseJob('add-user-hostname', { username: 'alice', hostname: 'dyn.example.org' }).type,
    ).toBe('add-user-hostname');
    expect(
      parseJob('remove-user-hostname', { username: 'alice', hostname: 'dyn.example.org' }).type,
    ).toBe('remove-user-hostname');
  });

  it('should_reject_hostnames_that_are_ip_literals_or_unsafe', () => {
    expect(() =>
      parseJob('add-user-hostname', { username: 'alice', hostname: '203.0.113.9' }),
    ).toThrow();
    expect(() =>
      parseJob('add-user-hostname', { username: 'alice', hostname: 'dyn.example.org;id' }),
    ).toThrow();
    expect(() =>
      parseJob('add-user-hostname', { username: 'alice', hostname: 'localhost' }),
    ).toThrow();
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

  it('should_parse_tracker_and_blocklist_jobs', () => {
    expect(
      parseJob('discover-tracker', {
        url: 'https://tracker.example.org:2710/announce',
        privacy: 'private',
      }).type,
    ).toBe('discover-tracker');
    expect(parseJob('fetch-tracker-cert', { host: 'tracker.example.org' }).type).toBe(
      'fetch-tracker-cert',
    );
    expect(parseJob('renew-tracker-certs', { today: '2026-07-24' }).type).toBe(
      'renew-tracker-certs',
    );
    expect(parseJob('mark-tracker-dead', { host: 'tracker.example.org' }).type).toBe(
      'mark-tracker-dead',
    );
    expect(parseJob('import-blocklist-catalog', {}).type).toBe('import-blocklist-catalog');
    expect(parseJob('update-blocklists', {}).type).toBe('update-blocklists');
    expect(parseJob('render-whitelist', {}).type).toBe('render-whitelist');
    expect(parseJob('render-blocklist-filters', {}).type).toBe('render-blocklist-filters');
    expect(parseJob('render-blocklist-filters', { username: 'alice' }).type).toBe(
      'render-blocklist-filters',
    );
    expect(
      parseJob('add-user-address', { username: 'alice', ipv4: '198.51.100.7' }).type,
    ).toBe('add-user-address');
    expect(
      parseJob('remove-user-address', { username: 'alice', ipv4: '198.51.100.7' }).type,
    ).toBe('remove-user-address');
  });

  it('should_reject_tracker_payloads_violating_invariants', () => {
    // the §5.1 injection shape must die at the wire boundary too
    expect(() =>
      parseJob('fetch-tracker-cert', { host: 'tracker.example.org;id' }),
    ).toThrow();
    expect(() => parseJob('fetch-tracker-cert', { host: '-x.example.org' })).toThrow();
    expect(() => parseJob('fetch-tracker-cert', { host: 'localhost' })).toThrow();
    expect(() =>
      parseJob('discover-tracker', { url: 'ftp://x.example.org/a', privacy: 'private' }),
    ).toThrow();
    expect(() =>
      parseJob('discover-tracker', { url: 'https://x.example.org/a', privacy: 'open' }),
    ).toThrow();
    expect(() => parseJob('renew-tracker-certs', { today: 'yesterday' })).toThrow();
    expect(() => parseJob('update-blocklists', { extra: true })).toThrow(); // strict object
    expect(() =>
      parseJob('add-user-address', { username: 'alice', ipv4: '256.1.1.1' }),
    ).toThrow();
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
