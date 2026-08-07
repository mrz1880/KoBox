import type { SpeedtestPort, SpeedtestRepositoryPort } from './SpeedtestPort.js';

interface Deps {
  readonly speedtest: SpeedtestPort;
  readonly repo: SpeedtestRepositoryPort;
  readonly clock: () => string;
}

// Runs one measurement and keeps it. Root-side: the portal only enqueues, so a
// test cannot be triggered by anything but a deliberate admin action.
export class RunSpeedtest {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const result = await this.deps.speedtest.measure(this.deps.clock());
    await this.deps.repo.save(result);
  }
}
