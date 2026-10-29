import type { RetiredService } from '../../domain/installation/retired.js';
import type { InstallHostPort, SystemdPort } from '../../domain/installation/ports.js';

interface Deps {
  readonly host: InstallHostPort;
  readonly systemd: SystemdPort;
  readonly retired: readonly RetiredService[];
}

// Takes away what a service KoBox no longer ships left on a box that ran it,
// so an upgrade leaves no daemon running that nothing manages any more. Every
// step converges: a box that never had the service, or one already cleaned,
// goes through it without a single systemctl call.
export class TearDownRetiredServices {
  constructor(private readonly deps: Deps) {}

  // Returns the units it stopped, for the installation run to report.
  async execute(): Promise<readonly string[]> {
    const { host, systemd, retired } = this.deps;
    const stopped: string[] = [];
    for (const service of retired) {
      // the unit file says whether this box still runs it: without one there
      // is nothing for systemd to stop, and no reason to pay a daemon-reload
      const running = await host.pathExists(service.unitFile);
      if (running) {
        await systemd.disable(service.unit, { now: true });
      }
      for (const file of service.files) {
        await host.removeFile(file);
      }
      for (const dir of service.dirs) {
        await host.removeDir(dir);
      }
      if (running) {
        // last, so a run interrupted before this point still finds the unit
        // and finishes the job next time
        await host.removeFile(service.unitFile);
        await systemd.daemonReload();
        stopped.push(service.unit);
      }
    }
    return stopped;
  }
}
