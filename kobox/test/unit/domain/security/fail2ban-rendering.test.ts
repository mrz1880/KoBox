import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  renderFail2banJails,
  renderNextcloudAuthFilter,
  renderPortalLoginFilter,
  renderPublickeyFloodFilter,
} from '../../../../src/domain/security/rendering.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/security');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

const ignoreIps = [IpAddress.parse('198.51.100.9'), IpAddress.parse('192.0.2.42')];

describe('renderFail2banJails', () => {
  it('should_render_the_kobox_jail_dropin', () => {
    const file = renderFail2banJails(ignoreIps, { sshPort: 22, portalPort: 8189 });
    expect(file.path).toBe('/etc/fail2ban/jail.d/kobox.local');
    expect(file.mode).toBe('0644');
    expect(file.owner).toBe('root');
    expectGolden('jail.kobox.local.golden', file.content);
  });

  it('should_always_ignore_loopback_and_sort_user_addresses', () => {
    const content = renderFail2banJails(ignoreIps, { sshPort: 22, portalPort: 8189 }).content;
    expect(content).toContain('ignoreip = 127.0.0.1/8 ::1 192.0.2.42 198.51.100.9');
  });

  it('should_enable_the_publickey_flood_jail_on_the_ssh_port', () => {
    const content = renderFail2banJails([], { sshPort: 8192, portalPort: 8189 }).content;
    expect(content).toContain('[kobox-publickey-flood]');
    expect(content).toContain('filter = kobox-publickey-flood');
    expect(content).toMatch(/\[kobox-publickey-flood\][^[]*port = 8192/);
    expect(content).toMatch(/\[sshd\][^[]*port = 8192/);
  });

  it('should_ban_well_above_human_rate_but_below_the_user_h_flood', () => {
    const content = renderFail2banJails([], { sshPort: 22, portalPort: 8189 }).content;
    // user-h: ~82 accepted keys/hour; 30/h is unreachable by hand, caught by script
    expect(content).toMatch(/\[kobox-publickey-flood\][^[]*maxretry = 30/);
    expect(content).toMatch(/\[kobox-publickey-flood\][^[]*findtime = 3600/);
  });

  it('should_enable_the_portal_login_jail', () => {
    const content = renderFail2banJails([], { sshPort: 22, portalPort: 8189 }).content;
    expect(content).toContain('[kobox-portal]');
    expect(content).toContain('filter = kobox-portal');
  });

  it('should_ban_on_every_port_the_portal_and_nextcloud_answer_on', () => {
    // the portal answers on its own port too: a ban on 80 and 443 alone let a
    // banned address carry on there
    const content = renderFail2banJails([], { sshPort: 22, portalPort: 8189 }).content;
    expect(content).toMatch(/\[kobox-portal\][^[]*port = http,https,8189/);
    expect(content).toMatch(/\[kobox-nextcloud\][^[]*port = http,https,8189/);
  });

  it('should_watch_nextcloud_sign_ins_from_the_web_server_log', () => {
    // its desktop and mobile apps sign in with the password, not through the
    // portal, so they need a jail of their own
    const content = renderFail2banJails([], { sshPort: 22, portalPort: 8189 }).content;
    expect(content).toMatch(/\[kobox-nextcloud\][^[]*filter = kobox-nextcloud/);
    expect(content).toMatch(/\[kobox-nextcloud\][^[]*logpath = \/var\/log\/nginx\/access\.log/);
  });
});

describe('renderPortalLoginFilter', () => {
  it('should_match_the_portal_login_failed_line_from_the_journal', () => {
    const file = renderPortalLoginFilter();
    expect(file.path).toBe('/etc/fail2ban/filter.d/kobox-portal.conf');
    expect(file.content).toContain('journalmatch = SYSLOG_IDENTIFIER=kobox-portal');
    expectGolden('filter.kobox-portal.conf.golden', file.content);
  });

  it('should_capture_the_host_from_a_portal_login_failed_line', () => {
    const failregex = /^failregex = (.+)$/m.exec(renderPortalLoginFilter().content)?.[1];
    const pattern = new RegExp((failregex ?? '').replace('<HOST>', '(?<host>[0-9.]+)'));
    const line = 'portal login failed for alice from 203.0.113.9 (invalid-credentials)';
    expect(pattern.exec(line)?.groups?.host).toBe('203.0.113.9');
  });
});

describe('renderPublickeyFloodFilter', () => {
  it('should_match_accepted_publickey_lines_from_the_journal', () => {
    const file = renderPublickeyFloodFilter();
    expect(file.path).toBe('/etc/fail2ban/filter.d/kobox-publickey-flood.conf');
    expect(file.content).toContain('journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd');
    expectGolden('filter.kobox-publickey-flood.conf.golden', file.content);
  });

  it('should_capture_the_host_from_a_real_sshd_line', () => {
    const failregex = /^failregex = (.+)$/m.exec(renderPublickeyFloodFilter().content)?.[1];
    expect(failregex).toBeDefined();
    const pattern = new RegExp(String(failregex).replace('<HOST>', '(?<host>\\S+)'));
    const line =
      'Accepted publickey for user-h from 203.0.113.55 port 51234 ssh2: RSA SHA256:abcdef';
    expect(pattern.exec(line)?.groups?.host).toBe('203.0.113.55');
    expect(pattern.test('Failed password for root from 203.0.113.55 port 22 ssh2')).toBe(false);
  });
});

describe('renderNextcloudAuthFilter', () => {
  const failregex = (): RegExp => {
    const raw = /^failregex = (.+)$/m.exec(renderNextcloudAuthFilter().content)?.[1] ?? '';
    return new RegExp(raw.replace('<HOST>', '(?<host>[0-9.]+)'));
  };

  it('should_count_a_refused_password_on_webdav_ocs_or_a_public_link', () => {
    expect(renderNextcloudAuthFilter().path).toBe('/etc/fail2ban/filter.d/kobox-nextcloud.conf');
    for (const request of [
      'GET /nextcloud/remote.php/dav/files/alice/ HTTP/2.0',
      'PROPFIND /nextcloud/remote.php/webdav/ HTTP/1.1',
      'GET /nextcloud/ocs/v2.php/cloud/user?format=json HTTP/1.1',
      'GET /nextcloud/public.php/dav/files/Abc123/ HTTP/1.1',
    ]) {
      const line = `203.0.113.9 - alice [27/Oct/2026:12:38:31 +0100] "${request}" 401 461 "-" "Nextcloud-iOS"`;
      expect(failregex().exec(line)?.groups?.host, request).toBe('203.0.113.9');
    }
  });

  it('should_leave_alone_a_client_asked_for_credentials_or_signed_in', () => {
    // the first request of a sync client carries no credentials and gets a 401
    // challenge: that is not a refused password
    const challenge = '203.0.113.9 - - [27/Oct/2026:12:38:31 +0100] "PROPFIND /nextcloud/remote.php/dav/ HTTP/1.1" 401 461 "-" "-"';
    const accepted = '203.0.113.9 - alice [27/Oct/2026:12:38:31 +0100] "PROPFIND /nextcloud/remote.php/dav/ HTTP/1.1" 207 4096 "-" "-"';
    expect(failregex().test(challenge)).toBe(false);
    expect(failregex().test(accepted)).toBe(false);
  });
});
