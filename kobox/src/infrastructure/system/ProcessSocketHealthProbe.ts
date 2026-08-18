import { connect } from 'node:net';
import type { HealthCheckResult, HealthProbePort } from '../../domain/user/ports.js';
import type { CommandRunner } from './CommandRunner.js';

// systemd "active" is not proof of life (a crashed rtorrent can still show
// as "active", a failed service can look up) — probe the process and socket.
export class ProcessSocketHealthProbe implements HealthProbePort {
  constructor(private readonly runner: CommandRunner) {}

  // Two daemons on the same box answer in opposite ways, and both answers are
  // real:
  //   rtorrent  comm "rtorrent main" (it renames its own thread), args "/usr/bin/rtorrent ..."
  //   systemd   comm "systemd",      args "/sbin/init"
  //
  // Matching comm alone missed rtorrent, so doctor reported it unhealthy on
  // every healthy box for months. Matching the command line alone missed init,
  // which CI caught. So: comm first, then the command line anchored on the
  // executable path, and healthy if either finds it. The anchor is what keeps a
  // member's torrent named "rtorrent" from making a dead daemon look alive.
  //
  // A check that always cries wolf is worse than no check: it teaches whoever
  // reads the output to skip that line, which is where the real failure is.
  async checkProcess(processName: string): Promise<HealthCheckResult> {
    const byComm = await this.runner.run({ command: 'pgrep', args: ['-x', processName] });
    const result =
      byComm.exitCode === 0
        ? byComm
        : await this.runner.run({
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
