import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigDocument } from '../../../../src/domain/installation/ConfigDocument.js';
import { FsConfigFileReader } from '../../../../src/infrastructure/system/FsConfigFileReader.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kobox-config-'));
  mkdirSync(join(root, 'etc/cron.d'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const scheduler = ConfigDocument.parse('scheduler');

describe('FsConfigFileReader', () => {
  it('should_return_the_file_as_written', async () => {
    writeFileSync(join(root, 'etc/cron.d/kobox'), '*/5 * * * * root kobox send-mails\n');

    const found = await new FsConfigFileReader(root).read(scheduler);

    expect(found?.content).toBe('*/5 * * * * root kobox send-mails\n');
    expect(found?.truncated).toBe(false);
  });

  it('should_report_nothing_when_the_component_was_never_installed', async () => {
    // an honest skip is the normal case: no NFS on this box means no exports
    // file, and that is information, not an error
    expect(await new FsConfigFileReader(root).read(scheduler)).toBeUndefined();
  });

  it('should_cap_what_it_reads_and_say_so', async () => {
    // rutorrent-users.conf grows with the member list; a page must not try to
    // render an unbounded file into a browser
    writeFileSync(join(root, 'etc/cron.d/kobox'), 'x'.repeat(300_000));

    const found = await new FsConfigFileReader(root).read(scheduler);

    expect(found?.truncated).toBe(true);
    expect(found?.content.length).toBeLessThan(300_000);
  });
});
