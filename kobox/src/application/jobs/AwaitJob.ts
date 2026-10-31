import type { JobProgressPort, JobState } from './JobProgressPort.js';

interface Deps {
  readonly progress: JobProgressPort;
  readonly pause: (ms: number) => Promise<void>;
  // how long a save may hold the answer back before the page says "in progress"
  readonly patienceMs: number;
  readonly everyMs: number;
}

function isSettled(state: JobState | undefined): boolean {
  return state !== 'pending' && state !== 'running';
}

// The portal hands every change to the worker, which looks for work once a
// second. Redirecting straight away showed the page as it was before the
// change; waiting a moment lets most changes land first. A longer job is left
// running and reported as it stands.
export class AwaitJob {
  constructor(private readonly deps: Deps) {}

  async execute(id: number): Promise<JobState | undefined> {
    let state = await this.deps.progress.stateOf(id);
    for (let waited = 0; !isSettled(state) && waited < this.deps.patienceMs; waited += this.deps.everyMs) {
      await this.deps.pause(this.deps.everyMs);
      state = await this.deps.progress.stateOf(id);
    }
    return state;
  }
}
