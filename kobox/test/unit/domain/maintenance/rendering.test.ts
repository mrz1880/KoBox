import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderCronFile, renderKoboxCommand } from '../../../../src/domain/maintenance/rendering.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/maintenance');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

describe('maintenance rendering', () => {
  it('should_render_the_declarative_cron_file_golden', () => {
    const file = renderCronFile({ koboxBin: '/usr/local/bin/kobox' });
    expect(file.path).toBe('/etc/cron.d/kobox');
    expect(file.mode).toBe('0644');
    expect(file.owner).toBe('root');
    expect(file.group).toBe('root');
    expectGolden('cron-kobox.golden', file.content);
  });

  it('should_run_every_entry_as_root_through_the_kobox_cli', () => {
    const file = renderCronFile({ koboxBin: '/usr/local/bin/kobox' });
    const entries = file.content
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#') && !/^[A-Z]+=/.test(line));
    expect(entries).toHaveLength(10);
    for (const line of entries) {
      expect(line).toMatch(/ root \/usr\/local\/bin\/kobox [a-z0-9-]+$/);
    }
  });

  it('should_install_the_kobox_command_as_an_executable_shell_script', () => {
    const file = renderKoboxCommand({
      nodeBin: '/usr/bin/node',
      currentLink: '/opt/kobox/current',
      koboxBin: '/usr/local/bin/kobox',
    });
    expect(file.path).toBe('/usr/local/bin/kobox');
    expect(file.mode).toBe('0755');
    expect(file.owner).toBe('root');
    expect(file.group).toBe('root');
    expect(file.content.split('\n')[0]).toBe('#!/bin/sh');
  });

  it('should_run_the_cli_through_the_current_release_link_with_every_argument', () => {
    // resolving through `current` is what lets an upgrade carry the command along
    const file = renderKoboxCommand({
      nodeBin: '/usr/bin/node',
      currentLink: '/opt/kobox/current',
      koboxBin: '/usr/local/bin/kobox',
    });
    expect(file.content).toBe(
      [
        '#!/bin/sh',
        '# KoBox-managed file, DO NOT EDIT (rendered declaratively).',
        'exec /usr/bin/node /opt/kobox/current/dist/interfaces/cli/main.js "$@"',
        '',
      ].join('\n'),
    );
  });
});
