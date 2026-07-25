import type { ConfigCheckPort, ConfigCheckResult } from '../../../domain/installation/ports.js';

export class FakeConfigChecks implements ConfigCheckPort {
  private sshdFailure: string | undefined;
  private nginxFailure: string | undefined;
  private bindFailure: string | undefined;

  failSshd(detail: string): void {
    this.sshdFailure = detail;
  }

  failNginx(detail: string): void {
    this.nginxFailure = detail;
  }

  failBind(detail: string): void {
    this.bindFailure = detail;
  }

  sshd(): Promise<ConfigCheckResult> {
    return Promise.resolve(this.result(this.sshdFailure));
  }

  nginx(): Promise<ConfigCheckResult> {
    return Promise.resolve(this.result(this.nginxFailure));
  }

  bind(): Promise<ConfigCheckResult> {
    return Promise.resolve(this.result(this.bindFailure));
  }

  private result(failure: string | undefined): ConfigCheckResult {
    return failure === undefined ? { ok: true } : { ok: false, detail: failure };
  }
}
