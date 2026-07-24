import type { FinishedScriptArgs, UserScriptRunnerPort } from '../../../domain/torrent/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export interface RecordedScriptRun extends FinishedScriptArgs {
  readonly username: string;
}

export class FakeUserScriptRunner implements UserScriptRunnerPort {
  readonly runs: RecordedScriptRun[] = [];

  runFinishedScripts(username: Username, args: FinishedScriptArgs): Promise<void> {
    this.runs.push({ username: username.value, ...args });
    return Promise.resolve();
  }
}
