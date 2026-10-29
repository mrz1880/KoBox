import { describe, expect, it } from 'vitest';

// The catalog is built and checked when the module loads: imported inside each
// test, a load-time failure fails that test instead of the whole file.
async function load(): Promise<typeof import('../../../../src/domain/installation/ConfigDocument.js')> {
  return import('../../../../src/domain/installation/ConfigDocument.js');
}

describe('ConfigDocument', () => {
  it('should_accept_every_document_in_the_catalog', async () => {
    const { ConfigDocument } = await load();
    for (const document of ConfigDocument.all()) {
      expect(ConfigDocument.parse(document.id).path, document.id).toBe(document.path);
    }
  });

  it('should_refuse_an_id_outside_the_catalog', async () => {
    const { ConfigDocument, UnknownConfigDocumentError } = await load();
    for (const bad of ['', 'passwd', '../scheduler', 'scheduler/../../etc/shadow']) {
      expect(() => ConfigDocument.parse(bad), bad).toThrow(UnknownConfigDocumentError);
    }
  });

  it('should_only_offer_files_kobox_writes_itself', async () => {
    const { ConfigDocument } = await load();
    // "what did KoBox put on my box" is the question this screen answers. A
    // browser over the whole filesystem would answer a different, far more
    // dangerous one.
    for (const document of ConfigDocument.all()) {
      expect(document.path.startsWith('/etc/'), document.path).toBe(true);
    }
  });

  it('should_refuse_to_catalogue_a_file_that_carries_a_secret', async () => {
    const { ConfigDocument, SecretBearingConfigError } = await load();
    // The catalog is checked when it is built, not merely in a test: an entry
    // added later that points at the worker env or a private key must fail to
    // load, not fail review.
    for (const secret of [
      '/etc/kobox/worker.env',
      '/etc/kobox/portal.env',
      '/etc/kobox/aria2.conf',
      '/etc/kobox/debrid-key.pem',
      '/etc/nginx/kobox.htpasswd',
      '/etc/openvpn/kobox-pki/private/ca.key',
    ]) {
      expect(() => ConfigDocument.of('probe', 'Probe', secret, 'probe'), secret).toThrow(
        SecretBearingConfigError,
      );
    }
  });

  it('should_refuse_to_catalogue_anything_outside_etc', async () => {
    const { ConfigDocument, ConfigPathOutsideEtcError } = await load();
    for (const outside of ['/home/alice/.ssh/authorized_keys', '/var/lib/kobox/kobox.db', 'etc/x']) {
      expect(() => ConfigDocument.of('probe', 'Probe', outside, 'probe'), outside).toThrow(
        ConfigPathOutsideEtcError,
      );
    }
  });

  it('should_leave_out_the_ssh_dropin_kobox_installs_unreadable', async () => {
    const { ConfigDocument } = await load();
    // it holds no secret, but it is 0600 and the portal is unprivileged.
    // Listing it would render "not on this box" for a file that is right there.
    const paths = ConfigDocument.all().map((document) => document.path);
    expect(paths).not.toContain('/etc/ssh/sshd_config.d/90-kobox.conf');
  });

  it('should_never_have_two_documents_claiming_the_same_id', async () => {
    const { ConfigDocument } = await load();
    const ids = ConfigDocument.all().map((document) => document.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should_refuse_certificates_private_keys_and_password_files_anywhere_under_etc', async () => {
    const { ConfigDocument, SecretBearingConfigError } = await load();
    for (const secret of [
      '/etc/letsencrypt/live/example.org/fullchain.conf',
      '/etc/letsencrypt/archive/example.org/privkey1.conf',
      '/etc/ssl/certs/example.crt',
      '/etc/ssl/private/example.key',
      '/etc/ssl/example.p12',
      '/etc/ssl/example.pem',
      '/etc/default/example.env',
      '/etc/shadow',
      '/etc/gshadow',
      '/etc/apache2/htpasswd.users',
    ]) {
      expect(() => ConfigDocument.of('probe', 'Probe', secret, 'probe'), secret).toThrow(
        SecretBearingConfigError,
      );
    }
  });

  it('should_accept_a_file_whose_name_only_resembles_a_secret_bearing_one', async () => {
    const { ConfigDocument } = await load();
    // the guard targets directories and extensions, not any path mentioning them
    for (const harmless of [
      '/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx',
      '/etc/letsencrypt/cli.ini',
      '/etc/nginx/conf.d/example.crt.conf',
      '/etc/nginx/conf.d/example.key.conf',
      '/etc/nginx/conf.d/example.env.conf',
      '/etc/nginx/conf.d/example.p12.conf',
      '/etc/nginx/conf.d/example.pem.conf',
      '/etc/kobox.conf',
      '/etc/openvpn.conf',
      '/etc/nginx/etc/kobox/site.conf',
      '/etc/nginx/etc/openvpn/site.conf',
      '/etc/nginx/etc/letsencrypt/live/site.conf',
    ]) {
      const document = ConfigDocument.of('probe', 'Probe', harmless, 'probe');
      expect(document.path, harmless).toBe(harmless);
    }
  });

  it('should_refuse_a_path_climbing_out_of_etc', async () => {
    const { ConfigDocument, ConfigPathOutsideEtcError } = await load();
    expect(() => ConfigDocument.of('probe', 'Probe', '/etc/../root/.ssh/id_ed25519.pub', 'probe')).toThrow(
      ConfigPathOutsideEtcError,
    );
  });

  it('should_name_the_refused_path_in_the_error', async () => {
    const { ConfigDocument } = await load();
    expect(() => ConfigDocument.of('probe', 'Probe', '/var/lib/kobox/kobox.db', 'probe')).toThrow(
      '/var/lib/kobox/kobox.db is outside /etc and cannot be catalogued',
    );
    expect(() => ConfigDocument.of('probe', 'Probe', '/etc/kobox/worker.env', 'probe')).toThrow(
      '/etc/kobox/worker.env carries a secret and must never be catalogued for viewing',
    );
    expect(() => ConfigDocument.parse('passwd')).toThrow('unknown config document "passwd"');
  });

  it('should_keep_what_it_was_built_with', async () => {
    const { ConfigDocument } = await load();
    const document = ConfigDocument.of('probe', 'Probe title', '/etc/probe.conf', 'What it decides.');
    expect(document.id).toBe('probe');
    expect(document.title).toBe('Probe title');
    expect(document.path).toBe('/etc/probe.conf');
    expect(document.purpose).toBe('What it decides.');
  });

  it('should_catalogue_exactly_the_files_kobox_renders_onto_the_host', async () => {
    const { ConfigDocument } = await load();
    expect(ConfigDocument.all().map((document) => [document.id, document.path])).toEqual([
      ['scheduler', '/etc/cron.d/kobox'],
      ['nginx-site', '/etc/nginx/conf.d/kobox.conf'],
      ['rutorrent-users', '/etc/nginx/kobox.d/rutorrent-users.conf'],
      ['portal-unit', '/etc/systemd/system/kobox-portal.service'],
      ['worker-unit', '/etc/systemd/system/kobox-worker.service'],
      ['aria2-unit', '/etc/systemd/system/kobox-aria2.service'],
      ['nanomon-unit', '/etc/systemd/system/kobox-nanomon.service'],
      ['firewall-unit', '/etc/systemd/system/kobox-firewall.service'],
      ['fail2ban-jails', '/etc/fail2ban/jail.d/kobox.local'],
      ['fail2ban-portal-filter', '/etc/fail2ban/filter.d/kobox-portal.conf'],
      ['fail2ban-publickey-filter', '/etc/fail2ban/filter.d/kobox-publickey-flood.conf'],
      ['nfs-exports', '/etc/exports.d/kobox.exports'],
      ['samba', '/etc/samba/smb.conf'],
      ['apt-sources', '/etc/apt/sources.list'],
      ['dnscrypt', '/etc/dnscrypt-proxy/dnscrypt-proxy.toml'],
      ['sysctl-dropin', '/etc/sysctl.d/90-kobox.conf'],
    ]);
  });

  it('should_tell_the_operator_what_every_catalogued_file_decides', async () => {
    const { ConfigDocument } = await load();
    for (const document of ConfigDocument.all()) {
      expect(document.title.trim(), document.id).not.toBe('');
      expect(document.purpose.trim(), document.id).not.toBe('');
    }
  });
});
