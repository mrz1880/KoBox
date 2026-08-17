import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderCronFile } from '../../../../src/domain/maintenance/rendering.js';

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
    expect(entries).toHaveLength(11);
    for (const line of entries) {
      expect(line).toMatch(/ root \/usr\/local\/bin\/kobox [a-z0-9-]+$/);
    }
  });
});
