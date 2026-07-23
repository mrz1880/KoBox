import { connect } from 'node:net';
import type { HealthCheckResult, HealthProbePort } from '../../domain/user/ports.js';
import type { CommandRunner } from './CommandRunner.js';

// systemd "active" is not proof of life (prod: crashed rtorrent shown active,
// Minio failed for 10 h unnoticed) — so probe the process table and the socket.
export class ProcessSocketHealthProbe implements HealthProbePort {
  constructor(private readonly runner: CommandRunner) {}

  async checkProcess(processName: string): Promise<HealthCheckResult> {
    const result = await this.runner.run({ command: 'pgrep', args: ['-x', processName] });
    return result.exitCode === 0
      ? { name: `process:${processName}`, state: 'healthy' }
      : { name: `process:${processName}`, state: 'unhealthy', detail: 'no such process' };
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    const name = `socket:${host}:${port}`;
    return new Promise((resolve) => {
      const socket = connect({ host, port, timeout: 2000 });
      const finish = (state: 'healthy' | 'unhealthy', detail?: string) => {
        socket.destroy();
        resolve(detail === undefined ? { name, state } : { name, state, detail });
      };
      socket.once('connect', () => {
        finish('healthy');
      });
      socket.once('error', (error) => {
        finish('unhealthy', error.message);
      });
      socket.once('timeout', () => {
        finish('unhealthy', 'timeout');
      });
    });
  }
}
