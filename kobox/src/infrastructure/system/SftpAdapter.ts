import type { SftpPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// sshd_config pairs this group with `Match Group kobox-sftp` -> ChrootDirectory
export const KOBOX_SFTP_GROUP = 'kobox-sftp';

export class SftpAdapter implements SftpPort {
  constructor(private readonly runner: CommandRunner) {}

  async enableChrootAccess(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'groupadd', args: ['-f', KOBOX_SFTP_GROUP] });
    await runOrThrow(this.runner, {
      command: 'usermod',
      args: ['-aG', KOBOX_SFTP_GROUP, username.value],
    });
  }

  async disableChrootAccess(username: Username): Promise<void> {
    const result = await this.runner.run({
      command: 'gpasswd',
      args: ['-d', username.value, KOBOX_SFTP_GROUP],
    });
    // exit 3 = not a member: removing an absent membership is idempotent
    if (result.exitCode !== 0 && result.exitCode !== 3) {
      throw new Error(`gpasswd -d failed with exit ${String(result.exitCode)}: ${result.stderr}`);
    }
  }

  async isChrootAccessEnabled(username: Username): Promise<boolean> {
    const result = await runOrThrow(this.runner, {
      command: 'id',
      args: ['-nG', username.value],
    });
    return result.stdout.trim().split(/\s+/).includes(KOBOX_SFTP_GROUP);
  }
}
