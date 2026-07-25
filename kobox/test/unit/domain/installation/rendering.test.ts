import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  InvalidWorkerEnvError,
  renderAptSources,
  renderBindLocal,
  renderBindOptions,
  renderCertbotDeployHook,
  renderDnscryptConfig,
  renderFirewallBootUnit,
  renderNginxVhost,
  renderRutorrentConfig,
  renderSshdDropin,
  renderSysctlTweaks,
  renderWorkerEnv,
  renderWorkerUnit,
} from '../../../../src/domain/installation/rendering.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/installation');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

describe('installation rendering', () => {
  it('should_render_the_worker_unit_golden', () => {
    const file = renderWorkerUnit({
      nodeBin: '/usr/bin/node',
      workerMain: '/opt/kobox/current/dist/interfaces/worker/main.js',
    });
    expect(file.path).toBe('/etc/systemd/system/kobox-worker.service');
    expect(file.mode).toBe('0644');
    // the watchdog replacement: a restart burst (upgrade + rollback) must
    // never leave the worker permanently dead on the start-rate limit
    expect(file.content).toContain('StartLimitIntervalSec=0');
    expectGolden('kobox-worker.service.golden', file.content);
  });

  it('should_render_the_firewall_boot_unit_golden_guarded_by_the_rules_file', () => {
    const file = renderFirewallBootUnit();
    expect(file.path).toBe('/etc/systemd/system/kobox-firewall.service');
    // Phase 3 debt #1: the persisted ruleset survives reboot, but only when
    // an apply already produced it — the Condition keeps first boot clean.
    expect(file.content).toContain('ConditionPathExists=/etc/kobox/firewall.rules');
    expect(file.content).toContain('iptables-restore /etc/kobox/firewall.rules');
    expectGolden('kobox-firewall.service.golden', file.content);
  });

  it('should_render_worker_env_sorted_and_reject_unsafe_entries', () => {
    const file = renderWorkerEnv(
      new Map([
        ['KOBOX_STRICT_SERVICES', '1'],
        ['KOBOX_DB', '/var/lib/kobox/kobox.db'],
      ]),
    );
    expect(file.path).toBe('/etc/kobox/worker.env');
    expect(file.mode).toBe('0600');
    expectGolden('worker.env.golden', file.content);

    expect(() => renderWorkerEnv(new Map([['bad-key', 'x']]))).toThrow(InvalidWorkerEnvError);
    expect(() => renderWorkerEnv(new Map([['KOBOX_X', 'a\nb']]))).toThrow(InvalidWorkerEnvError);
  });

  it('should_render_the_sshd_dropin_without_a_port_line_on_the_default_port', () => {
    const file = renderSshdDropin(22);
    expect(file.path).toBe('/etc/ssh/sshd_config.d/90-kobox.conf');
    expect(file.content).not.toContain('Port ');
    expect(file.content).toContain('PermitRootLogin prohibit-password');
    expectGolden('sshd_config.d-90-kobox.conf.golden', file.content);
  });

  it('should_emit_a_port_line_only_when_the_ssh_port_differs', () => {
    expect(renderSshdDropin(2222).content).toContain('Port 2222');
  });

  it('should_render_the_sysctl_tweaks_golden', () => {
    const file = renderSysctlTweaks();
    expect(file.path).toBe('/etc/sysctl.d/90-kobox.conf');
    expectGolden('sysctl.d-90-kobox.conf.golden', file.content);
  });

  it('should_render_canonical_debian_12_apt_sources', () => {
    const file = renderAptSources();
    expect(file.path).toBe('/etc/apt/sources.list');
    expect(file.content).toContain('bookworm-security');
    expectGolden('sources.list.golden', file.content);
  });

  it('should_render_a_deny_by_default_nginx_vhost_golden', () => {
    const file = renderNginxVhost({ portalPort: 8189 });
    expect(file.path).toBe('/etc/nginx/conf.d/kobox.conf');
    expect(file.content).toContain('listen 8189 ssl');
    expect(file.content).toContain('auth_basic_user_file /etc/nginx/kobox.htpasswd');
    // the ACME webroot is always served on :80 so certbot can validate
    // before any certificate exists
    expect(file.content).toContain('listen 80;');
    expect(file.content).toContain('location /.well-known/acme-challenge/');
    expect(file.content).toContain('root /var/www/acme;');
    expect(file.content).toContain('ssl-cert-snakeoil');
    expectGolden('nginx-kobox.conf.golden', file.content);
  });

  it('should_switch_to_the_lets_encrypt_paths_once_a_cert_was_issued', () => {
    const file = renderNginxVhost({
      portalPort: 8189,
      letsencrypt: { domain: 'box.example.org' },
    });
    expect(file.content).toContain('server_name box.example.org;');
    expect(file.content).toContain(
      'ssl_certificate /etc/letsencrypt/live/box.example.org/fullchain.pem;',
    );
    expect(file.content).toContain(
      'ssl_certificate_key /etc/letsencrypt/live/box.example.org/privkey.pem;',
    );
    expect(file.content).not.toContain('snakeoil');
    expectGolden('nginx-kobox.conf-letsencrypt.golden', file.content);
  });

  it('should_render_the_certbot_deploy_hook_golden', () => {
    const file = renderCertbotDeployHook();
    expect(file.path).toBe('/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx');
    expect(file.mode).toBe('0755');
    expect(file.content.startsWith('#!/bin/sh\n')).toBe(true);
    expect(file.content).toContain('systemctl reload nginx');
    expectGolden('certbot-deploy-hook.golden', file.content);
  });

  it('should_render_the_global_rutorrent_config_golden', () => {
    const file = renderRutorrentConfig();
    expect(file.path).toBe('/var/www/rutorrent/conf/config.php');
    expectGolden('rutorrent-config.php.golden', file.content);
  });

  it('should_render_bind_files_wired_to_the_phase2_blacklist_zones', () => {
    const local = renderBindLocal();
    expect(local.path).toBe('/etc/bind/named.conf.local');
    expect(local.content).toContain('include "/etc/bind/kobox.zones.blacklists";');
    expectGolden('named.conf.local.golden', local.content);

    const options = renderBindOptions({ dnscryptForwarder: true });
    expect(options.path).toBe('/etc/bind/named.conf.options');
    expect(options.content).toContain('port 52');
    expectGolden('named.conf.options.golden', options.content);
  });

  it('should_render_bind_with_direct_recursion_when_dnscrypt_is_unavailable', () => {
    // dnscrypt-proxy is not packaged for Debian 12: bind must still resolve
    // (forward-only to a dead port would break the whole box's DNS)
    const options = renderBindOptions({ dnscryptForwarder: false });
    expect(options.content).not.toContain('forward only');
    expect(options.content).not.toContain('port 52');
    expectGolden('named.conf.options-direct.golden', options.content);
  });

  it('should_render_dnscrypt_listening_on_52_with_the_phase2_blocked_names_file', () => {
    const file = renderDnscryptConfig();
    expect(file.path).toBe('/etc/dnscrypt-proxy/dnscrypt-proxy.toml');
    expect(file.content).toContain("listen_addresses = ['127.0.0.1:52']");
    expect(file.content).toContain("blocked_names_file = '/etc/dnscrypt-proxy/blocked-names.txt'");
    expectGolden('dnscrypt-proxy.toml.golden', file.content);
  });
});
