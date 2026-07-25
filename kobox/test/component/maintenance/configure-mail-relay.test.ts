import { describe, expect, it } from 'vitest';
import { ConfigureMailRelay } from '../../../src/application/maintenance/ConfigureMailRelay.js';
import { FakeInstallHost } from '../../../src/infrastructure/system/fakes/FakeInstallHost.js';
import { FakeSystemd } from '../../../src/infrastructure/system/fakes/FakeSystemd.js';

const INPUT = {
  host: 'smtp.example.net',
  port: 587,
  user: 'relay-login',
  password: 's3cret relay pass',
};

function world() {
  const host = new FakeInstallHost();
  const systemd = new FakeSystemd();
  return {
    host,
    systemd,
    configure: new ConfigureMailRelay({ files: host, host, systemd }),
  };
}

describe('ConfigureMailRelay', () => {
  it('should_write_sasl_passwd_0600_and_postmap_it', async () => {
    const { host, configure } = world();

    await configure.execute(INPUT);

    const file = host.fileAt('/etc/postfix/sasl_passwd');
    expect(file?.content).toBe('[smtp.example.net]:587 relay-login:s3cret relay pass\n');
    expect(file?.mode).toBe('0600');
    expect(file?.owner).toBe('root');
    expect(host.postmapped).toEqual(['/etc/postfix/sasl_passwd']);
  });

  it('should_wire_the_relay_through_postconf_and_reload_postfix', async () => {
    const { host, systemd, configure } = world();

    await configure.execute(INPUT);

    expect(host.postconfSettings).toMatchObject({
      relayhost: '[smtp.example.net]:587',
      smtp_sasl_auth_enable: 'yes',
      smtp_sasl_password_maps: 'hash:/etc/postfix/sasl_passwd',
      smtp_sasl_security_options: 'noanonymous',
      smtp_tls_security_level: 'encrypt',
    });
    // the secret lives in the 0600 file only — never in a postconf argv
    expect(JSON.stringify(host.postconfSettings)).not.toContain('s3cret');
    expect(systemd.log).toContain('reload-or-restart postfix');
  });

  it('should_reject_a_relay_host_that_is_not_a_safe_fqdn', async () => {
    const { configure } = world();

    await expect(
      configure.execute({ ...INPUT, host: 'smtp.example.net;id' }),
    ).rejects.toThrow();
    await expect(configure.execute({ ...INPUT, port: 0 })).rejects.toThrow();
    await expect(configure.execute({ ...INPUT, user: 'bad user' })).rejects.toThrow();
  });
});
