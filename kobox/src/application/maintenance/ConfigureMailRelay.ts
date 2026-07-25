import type { InstallHostPort, SystemdPort } from '../../domain/installation/ports.js';
import type { ManagedFilesPort } from '../../domain/shared/files.js';

const SASL_PASSWD = '/etc/postfix/sasl_passwd';
// same shell-safe FQDN shape the tracker/dyndns contracts enforce
const RELAY_LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const RELAY_HOST_PATTERN = new RegExp(`^${RELAY_LABEL}(\\.${RELAY_LABEL})+$`, 'i');
const RELAY_USER_PATTERN = /^[\w.@+-]+$/;

export interface ConfigureMailRelayDeps {
  readonly files: ManagedFilesPort;
  readonly host: InstallHostPort;
  readonly systemd: SystemdPort;
}

export interface ConfigureMailRelayInput {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

export class InvalidRelaySettingsError extends Error {
  constructor(detail: string) {
    super(`invalid relay settings: ${detail}`);
    this.name = 'InvalidRelaySettingsError';
  }
}

// Direct-only root command (never a job: the secret must not transit the
// jobs table). The password lives in exactly one place — sasl_passwd, 0600 —
// and postconf argv never sees it.
export class ConfigureMailRelay {
  constructor(private readonly deps: ConfigureMailRelayDeps) {}

  async execute(input: ConfigureMailRelayInput): Promise<void> {
    if (!RELAY_HOST_PATTERN.test(input.host)) {
      throw new InvalidRelaySettingsError(`relay host ${JSON.stringify(input.host)}`);
    }
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new InvalidRelaySettingsError(`port ${String(input.port)}`);
    }
    if (!RELAY_USER_PATTERN.test(input.user)) {
      throw new InvalidRelaySettingsError(`user ${JSON.stringify(input.user)}`);
    }
    if (input.password === '' || input.password.includes('\n')) {
      throw new InvalidRelaySettingsError('password must be a non-empty single line');
    }
    const relay = `[${input.host}]:${String(input.port)}`;
    await this.deps.files.apply([
      {
        path: SASL_PASSWD,
        content: `${relay} ${input.user}:${input.password}\n`,
        mode: '0600',
        owner: 'root',
        group: 'root',
      },
    ]);
    await this.deps.host.postmap(SASL_PASSWD);
    await this.deps.host.postconf({
      relayhost: relay,
      smtp_sasl_auth_enable: 'yes',
      smtp_sasl_password_maps: `hash:${SASL_PASSWD}`,
      smtp_sasl_security_options: 'noanonymous',
      smtp_tls_security_level: 'encrypt',
    });
    await this.deps.systemd.reloadOrRestart('postfix');
  }
}
