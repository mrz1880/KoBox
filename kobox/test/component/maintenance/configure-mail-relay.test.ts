import { describe, expect, it } from 'vitest';
import {
  ApplyStoredMailRelay,
  ConfigureMailRelay,
  SaveMailRelay,
} from '../../../src/application/maintenance/ConfigureMailRelay.js';
import { RemotePassword } from '../../../src/domain/sync/RemotePassword.js';
import { InMemoryMailRelayRepository } from '../../../src/infrastructure/persistence/InMemoryMailRelayRepository.js';
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

  it('should_let_mail_leave_a_box_installed_as_local_only', async () => {
    // the postfix component preseeds "Local only", which sets both transports
    // to error: with only relayhost set, the first production box bounced
    // every message locally (relay=none, dsn=5.0.0) and never reached Gmail
    const { host, configure } = world();

    await configure.execute(INPUT);

    expect(host.postconfSettings).toMatchObject({
      default_transport: 'smtp',
      relay_transport: 'relay',
    });
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

// Reversible on purpose: these tests check what is stored and applied, not
// that a real seal is opaque
const SEAL = 'sealed:';
const sealer = { seal: (password: RemotePassword) => Promise.resolve(SEAL + password.reveal()) };
const opener = {
  open: (sealed: string) => Promise.resolve(RemotePassword.parse(sealed.slice(SEAL.length))),
};

describe('SaveMailRelay', () => {
  // the settings page reads what is stored: a relay wired from the command line
  // without being stored showed "No relay configured yet" on a box that mailed
  it('should_store_the_relay_the_settings_page_shows_with_its_password_sealed', async () => {
    const settings = new InMemoryMailRelayRepository();

    await new SaveMailRelay({ settings, sealer }).execute({
      ...INPUT,
      password: RemotePassword.parse(INPUT.password),
    });

    expect(await settings.get()).toEqual({
      host: 'smtp.example.net',
      port: 587,
      user: 'relay-login',
      sealedPassword: 'sealed:s3cret relay pass',
    });
  });

  it('should_leave_postfix_wired_to_what_it_stored_once_applied', async () => {
    const settings = new InMemoryMailRelayRepository();
    const { host, configure } = world();
    await new SaveMailRelay({ settings, sealer }).execute({
      ...INPUT,
      password: RemotePassword.parse(INPUT.password),
    });

    await new ApplyStoredMailRelay({ settings, opener, configure }).execute();

    expect(host.contentAt('/etc/postfix/sasl_passwd')).toBe(
      '[smtp.example.net]:587 relay-login:s3cret relay pass\n',
    );
  });
});
