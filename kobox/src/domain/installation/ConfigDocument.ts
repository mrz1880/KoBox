import { DomainError } from '../shared/DomainError.js';

export class UnknownConfigDocumentError extends DomainError {
  constructor(raw: string) {
    super(`unknown config document ${JSON.stringify(raw)}`);
  }
}

// KoBox writes its host configuration under /etc and nowhere else. Anything
// outside it is a member's home, a database or a runtime directory, and none of
// those belong on a screen whose promise is "here is what the installer wrote".
export class ConfigPathOutsideEtcError extends DomainError {
  constructor(path: string) {
    super(`${path} is outside /etc and cannot be catalogued`);
  }
}

export class SecretBearingConfigError extends DomainError {
  constructor(path: string) {
    super(`${path} carries a secret and must never be catalogued for viewing`);
  }
}

// Anything matching these never enters the catalog. This is not a filter over
// what an admin typed — no path from a request ever reaches here — it is a
// guard over what a FUTURE contributor may add. The screen's whole safety
// argument is "no entry carries a secret", and an argument that lives only in a
// review comment is one nobody enforces.
//
// /etc/kobox holds worker.env (AllDebrid key, aria2 RPC secret), portal.env and
// aria2.conf; /etc/openvpn holds the PKI; htpasswd files hold password hashes.
const SECRET_BEARING = [
  /^\/etc\/kobox\//,
  /^\/etc\/openvpn\//,
  /^\/etc\/letsencrypt\/(?:live|archive)\//,
  /\.(?:env|pem|key|p12|crt)$/,
  /htpasswd/,
  /shadow/,
];

export class ConfigDocument {
  private constructor(
    readonly id: string,
    readonly title: string,
    readonly path: string,
    // one line, in the operator's words: what does this file decide?
    readonly purpose: string,
  ) {}

  static of(id: string, title: string, path: string, purpose: string): ConfigDocument {
    if (!path.startsWith('/etc/') || path.includes('..')) {
      throw new ConfigPathOutsideEtcError(path);
    }
    for (const pattern of SECRET_BEARING) {
      if (pattern.test(path)) {
        throw new SecretBearingConfigError(path);
      }
    }
    return new ConfigDocument(id, title, path, purpose);
  }

  static parse(raw: string): ConfigDocument {
    const found = CATALOG.find((document) => document.id === raw);
    if (found === undefined) {
      throw new UnknownConfigDocumentError(raw);
    }
    return found;
  }

  static all(): readonly ConfigDocument[] {
    return CATALOG;
  }
}

// Every file KoBox itself renders onto the host, and nothing else. The question
// this answers is "what did the installer decide on my box" — not "show me any
// file", which would be a root shell with syntax highlighting.
//
// The SSH drop-in (/etc/ssh/sshd_config.d/90-kobox.conf) is deliberately NOT
// here: KoBox installs it 0600, and the portal runs unprivileged. Loosening a
// hardening file so a viewer could read it would trade real protection for
// convenience, and listing it while the read always fails would tell you it is
// absent when it is not. Read that one from a shell.
const CATALOG: readonly ConfigDocument[] = [
  ConfigDocument.of(
    'scheduler',
    'Scheduler',
    '/etc/cron.d/kobox',
    'Which maintenance jobs run, and when. Every line only enqueues a job.',
  ),
  ConfigDocument.of(
    'nginx-site',
    'Web front end',
    '/etc/nginx/conf.d/kobox.conf',
    'How the portal, ruTorrent and the monitoring page are exposed and gated.',
  ),
  ConfigDocument.of(
    'rutorrent-users',
    'ruTorrent per-user routing',
    '/etc/nginx/kobox.d/rutorrent-users.conf',
    'Which SCGI socket each member reaches. Regenerated when accounts change.',
  ),
  ConfigDocument.of(
    'portal-unit',
    'Portal service',
    '/etc/systemd/system/kobox-portal.service',
    'The non-root web process and everything systemd forbids it from touching.',
  ),
  ConfigDocument.of(
    'worker-unit',
    'Worker service',
    '/etc/systemd/system/kobox-worker.service',
    'The one privileged process: it executes the typed jobs the portal enqueues.',
  ),
  ConfigDocument.of(
    'aria2-unit',
    'Direct download service',
    '/etc/systemd/system/kobox-aria2.service',
    'The downloader that fetches debrid links into the staging area.',
  ),
  ConfigDocument.of(
    'nanomon-unit',
    'Monitoring service',
    '/etc/systemd/system/kobox-nanomon.service',
    'The metrics collector behind /monitoring, bound to the loopback only.',
  ),
  ConfigDocument.of(
    'firewall-unit',
    'Firewall service',
    '/etc/systemd/system/kobox-firewall.service',
    'Reapplies the packet filter at boot, before anything listens.',
  ),
  ConfigDocument.of(
    'fail2ban-jails',
    'Ban rules',
    '/etc/fail2ban/jail.d/kobox.local',
    'How many failures, over what window, earn how long a ban.',
  ),
  ConfigDocument.of(
    'fail2ban-portal-filter',
    'Ban filter: portal logins',
    '/etc/fail2ban/filter.d/kobox-portal.conf',
    'The pattern that recognises a failed portal login in the journal.',
  ),
  ConfigDocument.of(
    'fail2ban-publickey-filter',
    'Ban filter: SSH key flooding',
    '/etc/fail2ban/filter.d/kobox-publickey-flood.conf',
    'The pattern that recognises a client trying key after key.',
  ),
  ConfigDocument.of(
    'nfs-exports',
    'NFS shares',
    '/etc/exports.d/kobox.exports',
    'Which directories are offered over NFS, to which addresses.',
  ),
  ConfigDocument.of(
    'samba',
    'Windows shares',
    '/etc/samba/smb.conf',
    'The same directories over SMB, for machines that do not speak NFS.',
  ),
  ConfigDocument.of(
    'apt-sources',
    'Package sources',
    '/etc/apt/sources.list',
    'Where the system updates on the Updates screen actually come from.',
  ),
  ConfigDocument.of(
    'dnscrypt',
    'Encrypted DNS',
    '/etc/dnscrypt-proxy/dnscrypt-proxy.toml',
    'Which resolver the box uses, and how its answers are validated.',
  ),
  ConfigDocument.of(
    'sysctl-dropin',
    'Kernel tuning',
    '/etc/sysctl.d/90-kobox.conf',
    'Network buffers and limits sized for many simultaneous transfers.',
  ),
];
