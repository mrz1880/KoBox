import { describe, expect, it } from 'vitest';
import { DebridApiKey } from '../../../../src/domain/ddl/DebridApiKey.js';
import { DirectUrl } from '../../../../src/domain/ddl/DirectUrl.js';
import { FilehosterLink } from '../../../../src/domain/ddl/FilehosterLink.js';
import type { DebridPort, DebridResult } from '../../../../src/domain/ddl/ports.js';
import { LoggedDebrid } from '../../../../src/infrastructure/system/LoggedDebrid.js';

const link = FilehosterLink.parse('https://1fichier.example/abc');
const KEY = DebridApiKey.parse('SECRETKEYSECRETKEY');

function recordingLog(): { lines: unknown[][]; warn: (...args: unknown[]) => void } {
  const lines: unknown[][] = [];
  return { lines, warn: (...args) => { lines.push(args); } };
}

function debridThat(outcome: () => Promise<DebridResult>): DebridPort {
  return { unlock: outcome };
}

describe('a debrid refusal reaching the worker log', () => {
  // the member removes the failed line, and its message goes with it: the log
  // is what is left to tell which code AllDebrid answered
  it('should_log_the_refusal_and_still_fail_the_download', async () => {
    const log = recordingLog();
    const debrid = new LoggedDebrid(
      debridThat(() => Promise.reject(new Error('debrid error NO_SERVER: refused'))),
      log,
    );

    await expect(debrid.unlock(link, KEY)).rejects.toThrow('debrid error NO_SERVER: refused');
    expect(log.lines).toEqual([[{ reason: 'debrid error NO_SERVER: refused' }, 'debrid unlock failed']]);
  });

  it('should_log_nothing_when_the_link_is_unlocked', async () => {
    const log = recordingLog();
    const result = { direct: DirectUrl.parse('https://cdn.example.org/file.mkv') };
    const debrid = new LoggedDebrid(debridThat(() => Promise.resolve(result)), log);

    await expect(debrid.unlock(link, KEY)).resolves.toBe(result);
    expect(log.lines).toEqual([]);
  });
});
