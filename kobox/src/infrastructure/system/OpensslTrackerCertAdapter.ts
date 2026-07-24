import type { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import type { TrackerPort } from '../../domain/tracker/TrackerPort.js';
import type { FetchedCert, TrackerCertPort } from '../../domain/tracker/ports.js';
import type { CommandRunner } from './CommandRunner.js';

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/;

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

// The definitive closure of AUDIT §5.1: the legacy ran
//   timeout 10 bash -c "openssl s_client -connect ${Tracker}:${port} ..."
// with ${Tracker} straight from the DB. Here the host is a TrackerHost (shell-
// safe by construction) and reaches openssl as a discrete argv element — there
// is no shell string for it to escape from.
export class OpensslTrackerCertAdapter implements TrackerCertPort {
  constructor(private readonly runner: CommandRunner) {}

  async fetch(host: TrackerHost, port: TrackerPort): Promise<FetchedCert | undefined> {
    let sClient;
    try {
      sClient = await this.runner.run({
        command: 'openssl',
        args: [
          's_client',
          '-connect',
          `${host.value}:${String(port.value)}`,
          '-servername',
          host.value,
        ],
        stdin: '', // close stdin so s_client exits after the handshake
      });
    } catch (error) {
      if (isEnoent(error)) {
        throw error instanceof Error ? error : new Error('openssl missing');
      }
      return undefined; // timeout / spawn kill: the tracker just has no TLS for us
    }
    const match = PEM_BLOCK.exec(sClient.stdout);
    if (!match) {
      return undefined;
    }
    const pem = `${match[0]}\n`;

    const endDate = await this.runner.run({
      command: 'openssl',
      args: ['x509', '-enddate', '-noout'],
      stdin: pem,
    });
    if (endDate.exitCode !== 0) {
      return undefined; // a block that x509 cannot read is not a certificate
    }
    const notAfter = /notAfter=(.*)/.exec(endDate.stdout)?.[1]?.trim();
    const parsed = notAfter !== undefined ? Date.parse(notAfter) : Number.NaN;
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return { pem, expiresOn: new Date(parsed).toISOString().slice(0, 10) };
  }
}
