// Where a queued job stands, as the worker last wrote it.
export type JobState = 'pending' | 'running' | 'done' | 'failed';

export interface JobProgressPort {
  // undefined for an id the queue never held
  stateOf(id: number): Promise<JobState | undefined>;
}
