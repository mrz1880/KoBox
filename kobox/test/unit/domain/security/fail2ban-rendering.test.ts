import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  renderFail2banJails,
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
    const file = renderFail2banJails(ignoreIps, 22);
    expect(file.path).toBe('/etc/fail2ban/jail.d/kobox.local');
    expect(file.mode).toBe('0644');
    expect(file.owner).toBe('root');
    expectGolden('jail.kobox.local.golden', file.content);
  });

  it('should_always_ignore_loopback_and_sort_user_addresses', () => {
    const content = renderFail2banJails(ignoreIps, 22).content;
    expect(content).toContain('ignoreip = 127.0.0.1/8 ::1 192.0.2.42 198.51.100.9');
  });

  it('should_enable_the_publickey_flood_jail_on_the_ssh_port', () => {
    const content = renderFail2banJails([], 8192).content;
    expect(content).toContain('[kobox-publickey-flood]');
    expect(content).toContain('filter = kobox-publickey-flood');
    expect(content).toMatch(/\[kobox-publickey-flood\][^[]*port = 8192/);
    expect(content).toMatch(/\[sshd\][^[]*port = 8192/);
  });

  it('should_ban_well_above_human_rate_but_below_the_user_h_flood', () => {
    const content = renderFail2banJails([], 22).content;
    // user-h: ~82 accepted keys/hour; 30/h is unreachable by hand, caught by script
    expect(content).toMatch(/\[kobox-publickey-flood\][^[]*maxretry = 30/);
    expect(content).toMatch(/\[kobox-publickey-flood\][^[]*findtime = 3600/);
  });

  it('should_enable_the_portal_login_jail', () => {
    const content = renderFail2banJails([], 22).content;
    expect(content).toContain('[kobox-portal]');
    expect(content).toContain('filter = kobox-portal');
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
