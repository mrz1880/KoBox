import { describe, expect, it } from 'vitest';
import {
  ApplyStoredMailRelay,
  InvalidRelaySettingsError,
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

  it('should_accept_the_first_and_last_valid_port', async () => {
    for (const port of [1, 65535]) {
      const { host, configure } = world();

      await configure.execute({ ...INPUT, port });

      expect(host.postconfSettings.relayhost).toBe(`[smtp.example.net]:${String(port)}`);
    }
  });

  it('should_refuse_a_port_outside_the_tcp_range_or_not_whole', async () => {
    for (const port of [0, 65536, 587.5]) {
      const { host, configure } = world();

      await expect(configure.execute({ ...INPUT, port })).rejects.toThrow(
        new InvalidRelaySettingsError(`port ${String(port)}`),
      );
      expect(host.postmapped).toEqual([]);
    }
  });

  it('should_refuse_a_relay_host_without_a_dot', async () => {
    const { configure } = world();

    await expect(configure.execute({ ...INPUT, host: 'localhost' })).rejects.toThrow(
      new InvalidRelaySettingsError('relay host "localhost"'),
    );
  });

  it('should_refuse_a_relay_host_with_junk_before_or_after_the_name', async () => {
    for (const relayHost of [
      ' smtp.example.net',
      'smtp.example.net ',
      '-smtp.example.net',
      'smtp-.example.net',
      'smtp..example.net',
      `${'a'.repeat(64)}.example.net`,
    ]) {
      const { configure } = world();

      await expect(configure.execute({ ...INPUT, host: relayHost })).rejects.toThrow(
        InvalidRelaySettingsError,
      );
    }
  });

  it('should_accept_a_relay_host_in_capitals_or_with_inner_hyphens', async () => {
    for (const relayHost of ['SMTP.Example.NET', 'mail-relay.example.net', `${'a'.repeat(63)}.example.net`, 'a.b']) {
      const { host, configure } = world();

      await configure.execute({ ...INPUT, host: relayHost });

      expect(host.postconfSettings.relayhost).toBe(`[${relayHost}]:587`);
    }
  });

  it('should_accept_a_login_that_is_an_email_address', async () => {
    const { host, configure } = world();

    await configure.execute({ ...INPUT, user: 'alice.relay+box@example.org' });

    expect(host.contentAt('/etc/postfix/sasl_passwd')).toBe(
      '[smtp.example.net]:587 alice.relay+box@example.org:s3cret relay pass\n',
    );
  });

  it('should_refuse_a_login_with_junk_before_or_after_it', async () => {
    for (const user of ['', ' alice', 'alice ', 'alice:x', 'alice\n']) {
      const { configure } = world();

      await expect(configure.execute({ ...INPUT, user })).rejects.toThrow(
        new InvalidRelaySettingsError(`user ${JSON.stringify(user)}`),
      );
    }
  });

  it('should_refuse_an_empty_or_multi_line_password', async () => {
    for (const password of ['', 'first\nsecond']) {
      const { host, configure } = world();

      await expect(configure.execute({ ...INPUT, password })).rejects.toThrow(
        new InvalidRelaySettingsError('password must be a non-empty single line'),
      );
      expect(host.fileAt('/etc/postfix/sasl_passwd')).toBeUndefined();
    }
  });

  it('should_keep_the_password_file_owned_by_the_root_group', async () => {
    const { host, configure } = world();

    await configure.execute(INPUT);

    expect(host.fileAt('/etc/postfix/sasl_passwd')?.group).toBe('root');
  });

  it('should_name_its_error_so_callers_can_tell_it_apart', () => {
    const error = new InvalidRelaySettingsError('port 0');

    expect(error.name).toBe('InvalidRelaySettingsError');
    expect(error.message).toBe('invalid relay settings: port 0');
  });
});

describe('ApplyStoredMailRelay with nothing stored', () => {
  it('should_leave_postfix_as_it_is', async () => {
    const { host, systemd, configure } = world();

    await new ApplyStoredMailRelay({
      settings: new InMemoryMailRelayRepository(),
      opener: {
        open: () => Promise.reject(new Error('nothing should be opened')),
      },
      configure,
    }).execute();

    expect(host.postconfSettings).toEqual({});
    expect(systemd.log).toEqual([]);
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
