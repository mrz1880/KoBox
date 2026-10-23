import type { HealthCheckResult, HealthProbePort } from '../../../domain/user/ports.js';

// Healthy unless a process was marked down. Results are named the way
// ProcessSocketHealthProbe names them.
export class FakeHealthProbe implements HealthProbePort {
  private readonly downProcesses = new Set<string>();

  markProcessDown(name: string): void {
    this.downProcesses.add(name);
  }

  checkProcess(processName: string): Promise<HealthCheckResult> {
    return Promise.resolve({
      name: `process:${processName}`,
      state: this.downProcesses.has(processName) ? 'unhealthy' : 'healthy',
    });
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    return Promise.resolve({ name: `socket:${host}:${port}`, state: 'healthy' });
  }
}
