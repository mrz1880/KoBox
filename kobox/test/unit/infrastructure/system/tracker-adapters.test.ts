import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { TrackerHost } from '../../../../src/domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../../../src/domain/tracker/TrackerPort.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { CertStoreAdapter } from '../../../../src/infrastructure/system/CertStoreAdapter.js';
import { DnsLookupResolverAdapter } from '../../../../src/infrastructure/system/DnsLookupResolverAdapter.js';
import { decodeP2pDownload } from '../../../../src/infrastructure/system/HttpsBlocklistDownloadAdapter.js';
import { parseIblocklistCatalog } from '../../../../src/infrastructure/system/IblocklistCatalogAdapter.js';
import { NetworkServiceReloadAdapter } from '../../../../src/infrastructure/system/NetworkServiceReloadAdapter.js';
import { OpensslTrackerCertAdapter } from '../../../../src/infrastructure/system/OpensslTrackerCertAdapter.js';
import { RtorrentConfigAdapter } from '../../../../src/infrastructure/system/RtorrentConfigAdapter.js';
import { createLogger } from '../../../../src/infrastructure/logging/logger.js';

const host = TrackerHost.parse('tracker.example.org');
const port = TrackerPort.parse(443);
process.env.KOBOX_LOG_LEVEL = 'silent';
const logger = createLogger('test');

const PEM = `-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----`;
const S_CLIENT_OUTPUT = `CONNECTED(00000003)\ndepth=0 CN = tracker.example.org\n${PEM}\nsubject=CN = tracker.example.org\n`;

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  private readonly byFirstArg = new Map<string, CommandResult>();

  on(firstArg: string, result: Partial<CommandResult>): void {
    this.byFirstArg.set(firstArg, { stdout: '', stderr: '', exitCode: 0, ...result });
  }

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const key = request.args[0] ?? request.command;
    return Promise.resolve(this.byFirstArg.get(key) ?? { stdout: '', stderr: '', exitCode: 0 });
  }
}

describe('OpensslTrackerCertAdapter', () => {
  it('should_fetch_the_pem_and_expiry_via_argv_only_openssl_calls', async () => {
    const runner = new RecordingRunner();
    runner.on('s_client', { stdout: S_CLIENT_OUTPUT });
    runner.on('x509', { stdout: 'notAfter=Sep 15 12:00:00 2026 GMT\n' });
    const adapter = new OpensslTrackerCertAdapter(runner);

    const fetched = await adapter.fetch(host, port);

    expect(fetched?.pem).toBe(`${PEM}\n`);
    expect(fetched?.expiresOn).toBe('2026-09-15');
    // §5.1 closed: the host reaches openssl as a discrete argv element,
    // never inside a shell string.
    expect(runner.calls[0]?.command).toBe('openssl');
    expect(runner.calls[0]?.args).toEqual([
      's_client',
      '-connect',
      'tracker.example.org:443',
      '-servername',
      'tracker.example.org',
    ]);
    expect(runner.calls[0]?.stdin).toBe('');
    expect(runner.calls[1]?.args).toEqual(['x509', '-enddate', '-noout']);
    expect(runner.calls[1]?.stdin).toBe(`${PEM}\n`);
  });

  it('should_return_undefined_when_no_certificate_is_presented', async () => {
    const runner = new RecordingRunner();
    runner.on('s_client', { stdout: 'CONNECTED but no cert\n', exitCode: 1 });
    const adapter = new OpensslTrackerCertAdapter(runner);
    expect(await adapter.fetch(host, port)).toBeUndefined();
  });

  it('should_return_undefined_when_the_connection_times_out', async () => {
    const failing: CommandRunner = {
      run: () => Promise.reject(new Error('spawn failed')),
    };
    const adapter = new OpensslTrackerCertAdapter(failing);
    expect(await adapter.fetch(host, port)).toBeUndefined();
  });

  it('should_propagate_a_missing_openssl_binary', async () => {
    const enoent = Object.assign(new Error('spawn openssl ENOENT'), { code: 'ENOENT' });
    const failing: CommandRunner = { run: () => Promise.reject(enoent) };
    const adapter = new OpensslTrackerCertAdapter(failing);
    await expect(adapter.fetch(host, port)).rejects.toThrow(/ENOENT/);
  });

  it('should_return_undefined_when_the_expiry_cannot_be_parsed', async () => {
    const runner = new RecordingRunner();
    runner.on('s_client', { stdout: S_CLIENT_OUTPUT });
    runner.on('x509', { stdout: 'garbage\n', exitCode: 1 });
    const adapter = new OpensslTrackerCertAdapter(runner);
    expect(await adapter.fetch(host, port)).toBeUndefined();
  });
});

describe('CertStoreAdapter', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-certs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should_install_remove_and_rehash_the_store', async () => {
    const runner = new RecordingRunner();
    const files = new RtorrentConfigAdapter(runner);
    const store = new CertStoreAdapter(files, runner, logger, dir);

    await store.install(host, `${PEM}\n`);
    const pemPath = join(dir, 'tracker.example.org.pem');
    expect(existsSync(pemPath)).toBe(true);

    await store.rehash();
    expect(
      runner.calls.some(
        (call) => call.command === 'openssl' && call.args[0] === 'rehash' && call.args[1] === dir,
      ),
    ).toBe(true);

    await store.remove(host);
    await store.remove(host); // idempotent
    expect(existsSync(pemPath)).toBe(false);
  });

  it('should_swallow_rehash_failures', async () => {
    const runner = new RecordingRunner();
    runner.on('rehash', { exitCode: 1, stderr: 'boom' });
    const store = new CertStoreAdapter(new RtorrentConfigAdapter(runner), runner, logger, dir);
    await expect(store.rehash()).resolves.toBeUndefined();
  });
});

describe('DnsLookupResolverAdapter', () => {
  it('should_resolve_and_drop_unusable_addresses', async () => {
    const adapter = new DnsLookupResolverAdapter(() =>
      Promise.resolve([
        { address: '192.0.2.10', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    );
    const ips = await adapter.resolveA(host);
    expect(ips.map((ip: IpAddress) => ip.value)).toEqual(['192.0.2.10']);
  });

  it('should_return_empty_on_nxdomain', async () => {
    const enotfound = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const adapter = new DnsLookupResolverAdapter(() => Promise.reject(enotfound));
    expect(await adapter.resolveA(host)).toEqual([]);
  });

  it('should_propagate_transient_resolver_failures', async () => {
    const eagain = Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' });
    const adapter = new DnsLookupResolverAdapter(() => Promise.reject(eagain));
    // transient failure must NOT read as "tracker is dead"
    await expect(adapter.resolveA(host)).rejects.toThrow(/EAI_AGAIN/);
  });
});

describe('decodeP2pDownload', () => {
  it('should_gunzip_parse_p2p_lines_and_hash_the_raw_body', () => {
    const text = 'Some org:192.0.2.0-192.0.2.255\nEvil corp:198.51.100.0-198.51.100.127\n';
    const body = gzipSync(Buffer.from(text));

    const decoded = decodeP2pDownload(body);

    expect(decoded?.ranges).toEqual([
      '192.0.2.0-192.0.2.255',
      '198.51.100.0-198.51.100.127',
    ]);
    expect(decoded?.sha256).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('should_accept_plain_text_bodies_with_bare_ranges', () => {
    const body = Buffer.from('10.0.0.0/8\n# comment\n192.0.2.1-192.0.2.9\n');
    expect(decodeP2pDownload(body)?.ranges).toEqual(['10.0.0.0/8', '192.0.2.1-192.0.2.9']);
  });

  it('should_reject_a_corrupted_gzip_body', () => {
    const corrupted = gzipSync(Buffer.from('x'.repeat(100))).subarray(0, 12);
    expect(decodeP2pDownload(corrupted)).toBeUndefined();
  });

  it('should_reject_an_empty_result', () => {
    expect(decodeP2pDownload(Buffer.from('# only comments\n'))).toBeUndefined();
  });
});

describe('parseIblocklistCatalog', () => {
  const XML = `<lists>
<list>
 <name>level1</name>
 <author>Example Org</author>
 <list>ydxerpxkpcfqjaybcssw</list>
 <subscription>false</subscription>
</list>
<list>
 <name>paid list</name>
 <author>Example Org</author>
 <list>aaaabbbbccccddddeeee</list>
 <subscription>true</subscription>
</list>
</lists>
`;

  it('should_extract_entries_with_https_download_urls', () => {
    const entries = parseIblocklistCatalog(XML);
    expect(entries).toEqual([
      {
        name: 'level1',
        author: 'Example Org',
        listId: 'ydxerpxkpcfqjaybcssw',
        url: 'https://list.iblocklist.com/?list=ydxerpxkpcfqjaybcssw&fileformat=p2p&archiveformat=gz',
        subscription: false,
      },
      {
        name: 'paid list',
        author: 'Example Org',
        listId: 'aaaabbbbccccddddeeee',
        url: 'https://list.iblocklist.com/?list=aaaabbbbccccddddeeee&fileformat=p2p&archiveformat=gz',
        subscription: true,
      },
    ]);
  });

  it('should_skip_records_missing_a_list_id', () => {
    expect(parseIblocklistCatalog('<lists>\n<list>\n <name>x</name>\n</list>\n</lists>')).toEqual(
      [],
    );
  });
});

describe('NetworkServiceReloadAdapter', () => {
  it('should_reload_dns_and_peerguardian_best_effort', async () => {
    const runner = new RecordingRunner();
    const adapter = new NetworkServiceReloadAdapter(runner, logger);

    await adapter.reloadDns();
    await adapter.reloadPeerGuardian();

    const commands = runner.calls.map((call) => [call.command, ...call.args].join(' '));
    expect(commands).toContain('rndc reload');
    expect(commands).toContain('systemctl try-restart dnscrypt-proxy');
    expect(commands).toContain('pglcmd reload');
  });

  it('should_swallow_failures_because_the_services_belong_to_phase_3', async () => {
    const failing: CommandRunner = { run: () => Promise.reject(new Error('absent')) };
    const adapter = new NetworkServiceReloadAdapter(failing, logger);
    await expect(adapter.reloadDns()).resolves.toBeUndefined();
    await expect(adapter.reloadPeerGuardian()).resolves.toBeUndefined();
  });
});
