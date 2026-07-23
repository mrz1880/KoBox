import { execFile } from 'node:child_process';

export interface CommandRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin?: string;
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// Argv-only by type: there is no API to pass a shell string, which removes the
// legacy `bash -c "... ${var} ..."` injection class wholesale (AUDIT §5.1).
export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

export class CommandFailedError extends Error {
  constructor(request: CommandRequest, result: CommandResult) {
    // argv is safe to include: callers pass VO-validated values, never secrets
    // (secrets travel via stdin, which is deliberately not echoed here).
    super(
      `${request.command} ${request.args.join(' ')} failed with exit ${String(result.exitCode)}: ${result.stderr.trim()}`,
    );
    this.name = 'CommandFailedError';
  }
}

export async function runOrThrow(
  runner: CommandRunner,
  request: CommandRequest,
): Promise<CommandResult> {
  const result = await runner.run(request);
  if (result.exitCode !== 0) {
    throw new CommandFailedError(request, result);
  }
  return result;
}

export class ExecFileRunner implements CommandRunner {
  run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        request.command,
        [...request.args],
        { encoding: 'utf8', timeout: 60_000 },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') {
            // spawn failure (ENOENT, timeout kill) — not a command exit code
            reject(error instanceof Error ? error : new Error('spawn failed'));
            return;
          }
          resolve({ stdout, stderr, exitCode: error && typeof error.code === 'number' ? error.code : 0 });
        },
      );
      if (request.stdin !== undefined) {
        // EPIPE from a child that died before reading stdin must not crash us;
        // the exit-code path already reports the failure
        child.stdin?.on('error', () => undefined);
        child.stdin?.write(request.stdin);
        child.stdin?.end();
      }
    });
  }
}
