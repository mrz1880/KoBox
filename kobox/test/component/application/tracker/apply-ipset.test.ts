import { beforeEach, describe, expect, it } from 'vitest';
import { ApplyIpset } from '../../../../src/application/tracker/ApplyIpset.js';
import { IPSET_FILE } from '../../../../src/domain/tracker/rendering.js';
import { FakeBlocklistCache } from '../../../../src/infrastructure/system/fakes/FakeBlocklistCache.js';
import { FakeIpset } from '../../../../src/infrastructure/system/fakes/FakeIpset.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';

let cache: FakeBlocklistCache;
let files: FakeRtorrentConfig;
let ipset: FakeIpset;

beforeEach(() => {
  cache = new FakeBlocklistCache();
  files = new FakeRtorrentConfig();
  ipset = new FakeIpset();
});

function applyIpset(): ApplyIpset {
  return new ApplyIpset({ cache, files, ipset });
}

describe('ApplyIpset', () => {
  it('should_render_the_cache_and_swap_it_into_the_kernel_set', async () => {
    await cache.write(['192.0.2.0/24', '198.51.100.1-198.51.100.9']);

    const report = await applyIpset().execute();

    expect(report).toEqual({ applied: true, entries: 2, rejected: 0 });
    expect(files.contentAt(IPSET_FILE)).toContain('add kobox-bl-next 192.0.2.0/24\n');
    expect(ipset.restored).toEqual([IPSET_FILE]);
  });

  it('should_count_the_cache_lines_the_render_refused', async () => {
    // a rotting cache must show, not be filtered away in silence
    await cache.write(['192.0.2.0/24', 'not an address', 'evil;rm -rf /']);

    const report = await applyIpset().execute();

    expect(report.entries).toBe(1);
    expect(report.rejected).toBe(2);
  });

  it('should_render_the_file_but_skip_the_swap_when_the_host_lacks_ipset', async () => {
    ipset.supported = false;
    await cache.write(['192.0.2.0/24', 'junk']);

    const report = await applyIpset().execute();

    expect(report).toMatchObject({ applied: false, entries: 1, rejected: 1 });
    expect(report.reason).toMatch(/^ipset unavailable \(no binary or kernel ip_set support\)/);
    // the boot oneshot replays the file once the module is there
    expect(files.contentAt(IPSET_FILE)).toContain('add kobox-bl-next 192.0.2.0/24\n');
    expect(ipset.restored).toEqual([]);
  });

  it('should_apply_an_empty_set_when_the_cache_is_empty', async () => {
    const report = await applyIpset().execute();

    expect(report).toEqual({ applied: true, entries: 0, rejected: 0 });
    expect(files.contentAt(IPSET_FILE)).not.toContain('add ');
  });
});
