import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JOB_TYPES, jobPayloadSchemas, parseJob } from '../../src/application/jobs/contract.js';

// shaped like an RSA-4096 OAEP block in base64: 684 characters
const SEALED = `${'A'.repeat(682)}==`;

describe('job contract', () => {
  it('should_expose_a_closed_set_of_job_types', () => {
    expect(JOB_TYPES).toEqual([
      'create-user',
      'delete-user',
      'change-password',
      'set-user-quota',
      'set-user-role',
      'sample-disk-usage',
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
      'remove-watch-dir',
      'rename-watch-dir',
    'set-category-sync-mode',
    'check-sync-destination',
    'send-pending-transfers',
    'queue-folder-backlog',
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
    'restart-stalled-hash-checks',
      'apply-ipset',
      'set-fair-use-override',
      'render-rutorrent-users',
      'render-nfs-exports',
      'clean-up-space',
      'set-automatic-cleanup',
      'set-seed-rule',
      'set-own-seed-rule',
      'reserve-member-ports',
    ]);
  });

  it('should_default_create_user_role_to_user_and_accept_admin', () => {
    const payload = {
      username: 'alice',
      email: 'alice@example.org',
      quotaBytes: 1,
      proxyPort: 8080,
      sealedPassword: SEALED,
    };

    const plain = parseJob('create-user', payload);
    const admin = parseJob('create-user', { ...payload, role: 'admin' });

    if (plain.type === 'create-user' && admin.type === 'create-user') {
      expect(plain.payload.role).toBe('user');
      expect(admin.payload.role).toBe('admin');
    }
    expect(() => parseJob('create-user', { ...payload, role: 'superuser' })).toThrow();
  });

  it('should_parse_a_role_change_and_refuse_a_role_the_portal_does_not_know', () => {
    expect(parseJob('set-user-role', { username: 'alice', role: 'admin' }).payload).toEqual({
      username: 'alice',
      role: 'admin',
    });
    expect(() => parseJob('set-user-role', { username: 'alice', role: 'superuser' })).toThrow();
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

  it('should_parse_the_member_port_reservation_job_without_payload', () => {
    expect(parseJob('reserve-member-ports', {}).type).toBe('reserve-member-ports');
    expect(() => parseJob('reserve-member-ports', { port: 45000 })).toThrow();
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
    ).toThrow('IPv4 literal, use add-user-address instead');
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
      quotaBytes: 412 * 1024 ** 3,
      proxyPort: 8080,
      sealedPassword: SEALED,
    });

    expect(job.type).toBe('create-user');
    if (job.type === 'create-user') {
      expect(job.payload.username).toBe('alice');
    }
  });

  it('should_still_parse_a_create_user_job_queued_with_the_retired_account_type', () => {
    const job = parseJob('create-user', {
      username: 'alice',
      email: 'alice@example.org',
      accountType: 'plex',
      quotaBytes: 1,
      proxyPort: 8080,
      sealedPassword: SEALED,
    });

    expect(job.type).toBe('create-user');
    expect(job.payload).not.toHaveProperty('accountType');
  });

  it('should_parse_a_create_user_job_for_an_invited_member_without_a_password', () => {
    const job = parseJob('create-user', {
      username: 'alice',
      email: 'alice@example.org',
      quotaBytes: 1,
      proxyPort: 8080,
    });

    expect(job.payload).not.toHaveProperty('sealedPassword');
  });

  it('should_reject_unknown_keys_on_a_create_user_job', () => {
    expect(() =>
      parseJob('create-user', {
        username: 'alice',
        email: 'alice@example.org',
        quotaBytes: 1,
        proxyPort: 8080,
        sealedPassword: SEALED,
        extra: 1,
      }),
    ).toThrow();
  });

  it('should_reject_unknown_job_types', () => {
    expect(() => parseJob('rm-rf', { username: 'alice' })).toThrow(/unknown job type/);
  });

  it('should_reject_payloads_violating_domain_invariants', () => {
    expect(() => parseJob('suspend-user', { username: 'Tony Z; rm -rf /' })).toThrow();
    expect(() => parseJob('suspend-user', { username: 'root' })).toThrow();
    expect(() =>
      parseJob('change-password', { username: 'alice', sealedPassword: 'plaintextpassword' }),
    ).toThrow();
    // the hash the portal used to send is no longer how a password travels
    expect(() =>
      parseJob('change-password', {
        username: 'alice',
        passwordHash: '$6$testsalt$0123456789abcdefghijklmnopqrstuv',
      }),
    ).toThrow();
    expect(() =>
      parseJob('create-user', {
        username: 'alice',
        email: 'not-an-email',
          quotaBytes: 1,
        proxyPort: 8080,
        sealedPassword: SEALED,
      }),
    ).toThrow();
  });

  it('should_parse_torrent_lifecycle_jobs', () => {
    expect(parseJob('provision-rtorrent', { username: 'alice' }).type).toBe('provision-rtorrent');
    expect(parseJob('add-watch-dir', { username: 'alice', label: 'films' }).type).toBe(
      'add-watch-dir',
    );
    expect(parseJob('queue-folder-backlog', { username: 'alice', label: 'Films' }).type).toBe(
      'queue-folder-backlog',
    );
    expect(parseJob('remove-watch-dir', { username: 'alice', label: 'Divers' }).type).toBe(
      'remove-watch-dir',
    );
    expect(
      parseJob('rename-watch-dir', { username: 'alice', label: 'Divers', to: 'Docs' }).type,
    ).toBe('rename-watch-dir');
    // the new name becomes a directory too: the same rule as for a new folder
    expect(() =>
      parseJob('rename-watch-dir', { username: 'alice', label: 'Divers', to: '../up' }),
    ).toThrow();
    expect(parseJob('set-sync-disabled', { username: 'alice', disabled: true }).type).toBe(
      'set-sync-disabled',
    );
    expect(
      parseJob('set-allow-public-tracker', { username: 'alice', allowed: false }).type,
    ).toBe('set-allow-public-tracker');
  });

  // a check queued before the trust choice existed, or one that does not say,
  // never accepts a changed identity of the member's machine
  it('should_parse_a_destination_check_that_keeps_the_recorded_identity_unless_told_otherwise', () => {
    expect(parseJob('check-sync-destination', { username: 'alice' }).payload).toEqual({
      username: 'alice',
      trust: 'keep-recorded',
    });
    expect(
      parseJob('check-sync-destination', { username: 'alice', trust: 'accept-presented' }).payload,
    ).toEqual({ username: 'alice', trust: 'accept-presented' });
    expect(() => parseJob('check-sync-destination', { username: 'alice', trust: 'any' })).toThrow();
  });

  it('should_parse_a_cleanup_of_the_torrents_a_member_picked', () => {
    const infoHashes = ['A'.repeat(40), 'b'.repeat(40)];

    // a job queued before automatic cleanup existed carries no trigger: the
    // member asked for it
    expect(parseJob('clean-up-space', { username: 'alice', infoHashes }).payload).toEqual({
      username: 'alice',
      infoHashes,
      trigger: 'member',
    });
  });

  it('should_parse_a_cleanup_the_hourly_pass_ran_for_the_member_and_refuse_another_trigger', () => {
    const infoHashes = ['A'.repeat(40)];

    expect(
      parseJob('clean-up-space', { username: 'alice', infoHashes, trigger: 'automatic' }).payload,
    ).toEqual({ username: 'alice', infoHashes, trigger: 'automatic' });
    expect(() =>
      parseJob('clean-up-space', { username: 'alice', infoHashes, trigger: 'admin' }),
    ).toThrow();
  });

  it('should_refuse_a_cleanup_with_no_torrent_too_many_or_one_that_is_not_a_hash', () => {
    expect(() => parseJob('clean-up-space', { username: 'alice', infoHashes: [] })).toThrow();
    expect(() =>
      parseJob('clean-up-space', { username: 'alice', infoHashes: Array(501).fill('A'.repeat(40)) }),
    ).toThrow();
    expect(() =>
      parseJob('clean-up-space', { username: 'alice', infoHashes: ['../../etc/shadow'] }),
    ).toThrow();
  });

  it('should_parse_a_members_automatic_cleanup_choice_and_refuse_one_the_page_does_not_offer', () => {
    expect(
      parseJob('set-automatic-cleanup', { username: 'alice', scope: 'sentOrSeeded' }).payload,
    ).toEqual({ username: 'alice', scope: 'sentOrSeeded', timing: 'whenSpaceRunsShort' });
    expect(() =>
      parseJob('set-automatic-cleanup', { username: 'alice', scope: 'everything' }),
    ).toThrow();
  });

  it('should_parse_when_a_member_lets_kobox_clean_and_refuse_a_timing_the_page_does_not_offer', () => {
    expect(
      parseJob('set-automatic-cleanup', { username: 'alice', scope: 'sentOnly', timing: 'onceRuleMet' })
        .payload,
    ).toEqual({ username: 'alice', scope: 'sentOnly', timing: 'onceRuleMet' });
    expect(() =>
      parseJob('set-automatic-cleanup', { username: 'alice', scope: 'sentOnly', timing: 'weekly' }),
    ).toThrow();
  });

  it('should_parse_a_seed_rule_within_what_an_admin_may_set', () => {
    expect(parseJob('set-seed-rule', { ratio: 1.5, days: 14 }).payload).toEqual({
      ratio: 1.5,
      days: 14,
    });
  });

  it.each([
    { ratio: 0.05, days: 7 },
    { ratio: 101, days: 7 },
    { ratio: 2, days: 0 },
    { ratio: 2, days: 366 },
    { ratio: 2, days: 1.5 },
  ])('should_refuse_a_seed_rule_out_of_bounds_%o', (payload) => {
    expect(() => parseJob('set-seed-rule', payload)).toThrow();
  });

  it.each([
    { username: 'alice', rule: { ratio: 1.5, days: 14 } },
    { username: 'alice', rule: { ratio: null, days: 14 } },
    { username: 'alice', rule: null },
  ])('should_parse_the_rule_a_member_set_or_their_return_to_the_box_rule_%o', (payload) => {
    expect(parseJob('set-own-seed-rule', payload).payload).toEqual(payload);
  });

  it.each([
    { username: 'alice', rule: { ratio: 0.05, days: 7 } },
    { username: 'alice', rule: { ratio: 101, days: 7 } },
    { username: 'alice', rule: { ratio: null, days: 0 } },
    { username: 'alice', rule: { ratio: null, days: 366 } },
    { username: 'alice', rule: { ratio: null, days: 1.5 } },
    { username: 'alice', rule: { days: 14 } },
    { username: '../root', rule: null },
  ])('should_refuse_a_members_rule_out_of_bounds_%o', (payload) => {
    expect(() => parseJob('set-own-seed-rule', payload)).toThrow();
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
