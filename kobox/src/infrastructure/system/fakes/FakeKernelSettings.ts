import type { KernelSettingsPort } from '../../../application/user/ReserveMemberPorts.js';

export class FakeKernelSettings implements KernelSettingsPort {
  readonly loaded: string[] = [];

  load(path: string): Promise<void> {
    this.loaded.push(path);
    return Promise.resolve();
  }
}
