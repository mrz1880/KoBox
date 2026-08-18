import { connect } from 'node:net';
import type { HealthCheckResult, HealthProbePort } from '../../domain/user/ports.js';
import type { CommandRunner } from './CommandRunner.js';

// systemd "active" is not proof of life (a crashed rtorrent can still show
// as "active", a failed service can look up) — probe the process and socket.
export class ProcessSocketHealthProbe implements HealthProbePort {
  constructor(private readonly runner: CommandRunner) {}

  // `pgrep -x` compares against comm, and rtorrent renames its main thread to
  // "rtorrent main". So the exact match found nothing on every box that was
  // running perfectly, and doctor reported unhealthy for months. A check that
  // always cries wolf is worse than no check: it teaches people to skip the
  // output, which is where the real failures are.
  //
  // Matching the full command line anchored on the executable path instead: a
  // member's torrent named "rtorrent" cannot make a dead daemon look alive.
  async checkProcess(processName: string): Promise<HealthCheckResult> {
    const result = await this.runner.run({
      command: 'pgrep',
      args: ['-f', `^(/[^ ]*/)?${processName}( |$)`],
    });
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
