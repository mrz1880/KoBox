import type { CertbotPort, CertbotRequest } from '../../application/maintenance/CertbotPort.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const CERTBOT_TIMEOUT_MS = 300_000;

export class CertbotAdapter implements CertbotPort {
  constructor(
    private readonly runner: CommandRunner,
    // CA bundle for a test ACME server's TLS (pebble's minica); production
    // leaves it unset and certbot talks to the real directory over WebPKI
    private readonly caBundle?: string,
  ) {}

  async obtain(request: CertbotRequest): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'certbot',
      args: [
        'certonly',
        '--webroot',
        '--webroot-path',
        request.webroot,
        '--domain',
        request.domain,
        '--email',
        request.email,
        '--agree-tos',
        '--non-interactive',
        '--no-eff-email',
        ...(request.acmeUrl !== undefined ? ['--server', request.acmeUrl] : []),
      ],
      timeoutMs: CERTBOT_TIMEOUT_MS,
      ...(this.caBundle !== undefined && { env: { REQUESTS_CA_BUNDLE: this.caBundle } }),
    });
  }
}
