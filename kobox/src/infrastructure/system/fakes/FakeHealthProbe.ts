import type { HealthCheckResult, HealthProbePort } from '../../../domain/user/ports.js';

// Healthy unless a process or a socket was marked down. Results are named the
// way ProcessSocketHealthProbe names them.
export class FakeHealthProbe implements HealthProbePort {
  private readonly downProcesses = new Set<string>();
  private readonly downSockets = new Set<string>();

  markProcessDown(name: string): void {
    this.downProcesses.add(name);
  }

  markSocketDown(host: string, port: number): void {
    this.downSockets.add(`${host}:${port}`);
  }

  checkProcess(processName: string): Promise<HealthCheckResult> {
    return Promise.resolve({
      name: `process:${processName}`,
      state: this.downProcesses.has(processName) ? 'unhealthy' : 'healthy',
    });
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    return Promise.resolve({
      name: `socket:${host}:${port}`,
      state: this.downSockets.has(`${host}:${port}`) ? 'unhealthy' : 'healthy',
    });
  }
}
