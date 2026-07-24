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
      args: [
        '-u',
        'ssh',
        '-u',
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
    return countAcceptedPublickeyLines(result.stdout, username.value);
  }
}
