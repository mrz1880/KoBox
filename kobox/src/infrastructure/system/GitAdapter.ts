import type { GitPort } from '../../application/maintenance/GitPort.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const GIT_TIMEOUT_MS = 120_000;

export class GitAdapter implements GitPort {
  constructor(private readonly runner: CommandRunner) {}

  private async git(repoDir: string, args: readonly string[]): Promise<string> {
    const result = await runOrThrow(this.runner, {
      command: 'git',
      args: ['-C', repoDir, ...args],
      timeoutMs: GIT_TIMEOUT_MS,
    });
    return result.stdout.trim();
  }

  async fetch(repoDir: string): Promise<void> {
    await this.git(repoDir, ['fetch', '--tags', '--quiet']);
  }

  async refExists(repoDir: string, ref: string): Promise<boolean> {
    const result = await this.runner.run({
      command: 'git',
      args: ['-C', repoDir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      timeoutMs: GIT_TIMEOUT_MS,
    });
    return result.exitCode === 0;
  }

  async resolveRef(repoDir: string, ref: string): Promise<string> {
    return this.git(repoDir, ['rev-parse', '--verify', `${ref}^{commit}`]);
  }

  async worktreeAdd(repoDir: string, path: string, ref: string): Promise<void> {
    // --detach: a release worktree is a frozen snapshot, never a branch.
    // --force: a path still registered from a hand-deleted worktree must not
    // block a retry (the use case reaps live ones before calling this).
    await this.git(repoDir, ['worktree', 'add', '--detach', '--force', path, ref]);
  }

  async worktreeRemove(repoDir: string, path: string): Promise<void> {
    // --force: node_modules and build output make every staged tree dirty
    await this.git(repoDir, ['worktree', 'remove', '--force', path]);
  }

  async currentRef(repoDir: string): Promise<string> {
    return this.git(repoDir, ['rev-parse', 'HEAD']);
  }
}
