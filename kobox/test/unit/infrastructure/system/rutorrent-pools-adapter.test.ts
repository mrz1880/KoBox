import { describe, expect, it } from 'vitest';
import type { RenderedFile } from '../../../../src/domain/shared/files.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { PhpFpmRutorrentPools } from '../../../../src/infrastructure/system/PhpFpmRutorrentPools.js';

const DIR = '/etc/php/8.4/fpm/pool.d';

class RecordingRunner implements CommandRunner {
  readonly calls: string[] = [];

  constructor(
    private readonly onDisk: readonly string[],
    private readonly configOk = true,
  ) {}

  run(request: CommandRequest): Promise<CommandResult> {
    const line = [request.command, ...request.args].join(' ');
    this.calls.push(line);
    if (request.command === 'find') {
      return Promise.resolve({ stdout: this.onDisk.map((name) => `${DIR}/${name}\n`).join(''), stderr: '', exitCode: 0 });
    }
    const failed = request.command === 'php-fpm8.4' && !this.configOk;
    return Promise.resolve({ stdout: '', stderr: failed ? 'ERROR: bad pool' : '', exitCode: failed ? 1 : 0 });
  }
}

class RecordingFiles {
  readonly applied: string[] = [];
  apply(files: readonly RenderedFile[]): Promise<readonly string[]> {
    this.applied.push(...files.map((file) => file.path));
    return Promise.resolve(files.map((file) => file.path));
  }
}

const pool = (member: string): RenderedFile => ({
  path: `${DIR}/kobox-ru-${member}.conf`,
  content: `[kobox-ru-${member}]\n`,
  mode: '0644',
  owner: 'root',
  group: 'root',
});

describe('PhpFpmRutorrentPools', () => {
  it('should_write_the_pools_drop_a_departed_members_and_reload_once_php_agrees', async () => {
    const runner = new RecordingRunner(['kobox-ru-alice.conf', 'kobox-ru-gone.conf']);
    const files = new RecordingFiles();

    await new PhpFpmRutorrentPools(runner, files).converge([pool('alice'), pool('bob')]);

    expect(files.applied).toEqual([`${DIR}/kobox-ru-alice.conf`, `${DIR}/kobox-ru-bob.conf`]);
    expect(runner.calls.filter((line) => !line.startsWith('find'))).toEqual([
      `rm -f -- ${DIR}/kobox-ru-gone.conf`,
      'php-fpm8.4 -t',
      'systemctl reload php8.4-fpm',
    ]);
  });

  // a reload with a broken pool would stop PHP for Nextcloud too
  it('should_refuse_to_reload_a_configuration_php_rejects', async () => {
    const runner = new RecordingRunner([], false);

    await expect(new PhpFpmRutorrentPools(runner, new RecordingFiles()).converge([pool('alice')])).rejects.toThrow();
    expect(runner.calls).not.toContain('systemctl reload php8.4-fpm');
  });
});
