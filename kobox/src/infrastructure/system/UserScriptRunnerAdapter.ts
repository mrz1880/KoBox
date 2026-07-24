import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FinishedScriptArgs, UserScriptRunnerPort } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { CommandRunner } from './CommandRunner.js';

type HomeResolver = (username: Username) => string;

const defaultHome: HomeResolver = (username) => `/home/${username.value}`;

// Runs the user's ~/scripts/*.sh on torrent completion, AS the user (runuser,
// argv only — the legacy ran them via screen with no privilege drop rigor).
// Best-effort by contract: a broken user script must never fail the event.
export class UserScriptRunnerAdapter implements UserScriptRunnerPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly homeOf: HomeResolver = defaultHome,
  ) {}

  async runFinishedScripts(username: Username, args: FinishedScriptArgs): Promise<void> {
    const scriptsDir = join(this.homeOf(username), 'scripts');
    let scripts: string[];
    try {
      scripts = readdirSync(scriptsDir)
        .filter((name) => name.endsWith('.sh'))
        .sort();
    } catch {
      return; // no scripts directory: nothing to do
    }
    for (const script of scripts) {
      await this.runner
        .run({
          command: 'runuser',
          args: [
            '-u',
            username.value,
            '--',
            join(scriptsDir, script),
            args.basePath,
            args.directory,
            args.label,
            args.name,
          ],
        })
        .catch(() => undefined); // spawn failures are also best-effort
    }
  }
}
