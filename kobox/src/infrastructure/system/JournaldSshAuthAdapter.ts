import type { SshAuthLogPort } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { CommandRunner } from './CommandRunner.js';

// Pure count over journalctl JSONL output.
export function countAcceptedPublickeyLines(jsonl: string, username: string): number {
  const needle = new RegExp(`^Accepted publickey for ${username} `);
  let count = 0;
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      const entry: unknown = JSON.parse(line);
      const message =
        typeof entry === 'object' && entry !== null && 'MESSAGE' in entry
          ? entry.MESSAGE
          : undefined;
      if (typeof message === 'string' && needle.test(message)) {
        count += 1;
      }
    } catch {
      // partial/garbled journal line: skip, never fail the meter
    }
  }
  return count;
}

// Where fail2ban is blind: counts ACCEPTED publickey logins per user from the
// journal. journalctl exits 1 with empty output when nothing matches the
// window — that is zero, not an error.
export class JournaldSshAuthAdapter implements SshAuthLogPort {
  constructor(private readonly runner: CommandRunner) {}

  async countAcceptedPublickey(username: Username, windowMinutes: number): Promise<number> {
    const result = await this.runner.run({
      command: 'journalctl',
      // --identifier (not -u): matches the real sshd's syslog identifier AND
      // fixture entries emitted via systemd-cat -t sshd
      args: [
        '--identifier',
        'sshd',
        '--since',
        `-${String(windowMinutes)}min`,
        '--grep',
        'Accepted publickey',
        '--output',
        'json',
        '--no-pager',
      ],
      timeoutMs: 10_000,
    });
    // exit 1 + empty output = "no entries matched" (normal quiet window);
    // anything else is a broken journal and must NOT read as calm — a blind
    // meter is exactly how user-h went unnoticed
    if (result.exitCode !== 0 && !(result.exitCode === 1 && result.stdout.trim() === '')) {
      throw new Error(`journalctl failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`);
    }
    return countAcceptedPublickeyLines(result.stdout, username.value);
  }
}
