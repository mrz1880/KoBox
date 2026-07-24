import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer, type Server } from 'node:tls';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Tracker } from '../../../src/domain/tracker/Tracker.js';
import { TrackerHost } from '../../../src/domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../../src/domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../../src/domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../../src/domain/tracker/TrackerProto.js';
import { renderBlacklistZones } from '../../../src/domain/tracker/rendering.js';
import { createLogger } from '../../../src/infrastructure/logging/logger.js';
import { CertStoreAdapter } from '../../../src/infrastructure/system/CertStoreAdapter.js';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { HttpsBlocklistDownloadAdapter } from '../../../src/infrastructure/system/HttpsBlocklistDownloadAdapter.js';
import { OpensslTrackerCertAdapter } from '../../../src/infrastructure/system/OpensslTrackerCertAdapter.js';
import { RtorrentConfigAdapter } from '../../../src/infrastructure/system/RtorrentConfigAdapter.js';

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const runner = new ExecFileRunner();
process.env.KOBOX_LOG_LEVEL = 'silent';
const logger = createLogger('int-test');

interface Keypair {
  readonly keyPath: string;
  readonly certPath: string;
}

function generateSelfSigned(dir: string, cn: string, san?: string): Keypair {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '30',
    '-subj',
    `/CN=${cn}`,
    // node's https client verifies SAN, not CN
    ...(san !== undefined ? ['-addext', `subjectAltName=${san}`] : []),
  ]);
  return { keyPath, certPath };
}

function listen(server: Server | ReturnType<typeof createHttpsServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

describe.skipIf(!onDebianAsRoot)('OpensslTrackerCertAdapter against a real TLS endpoint', () => {
  let dir: string;
  let server: Server | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-tls-'));
  });
  afterEach(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('should_fetch_the_served_certificate_and_its_expiry', async () => {
    const { keyPath, certPath } = generateSelfSigned(dir, 'tracker.example.org');
    server = createTlsServer({
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    });
    const port = await listen(server);

    const adapter = new OpensslTrackerCertAdapter(runner);
    const fetched = await adapter.fetch(TrackerHost.parse('127.0.0.1'), TrackerPort.parse(port));

    expect(fetched?.pem).toContain('BEGIN CERTIFICATE');
    expect(fetched?.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fetched && fetched.expiresOn > new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it('should_return_undefined_for_a_closed_port', async () => {
    const adapter = new OpensslTrackerCertAdapter(runner);
    // reserve a port then close it so nothing listens there
    const probe = createTlsServer({});
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));

    expect(
      await adapter.fetch(TrackerHost.parse('127.0.0.1'), TrackerPort.parse(port)),
    ).toBeUndefined();
  });
});

describe.skipIf(!onDebianAsRoot)('CertStoreAdapter against a real CApath', () => {
  it('should_install_and_rehash_producing_hash_links', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-capath-'));
    try {
      const { certPath } = generateSelfSigned(dir, 'tracker.example.org');
      const store = new CertStoreAdapter(
        new RtorrentConfigAdapter(runner),
        runner,
        logger,
        dir,
      );

      await store.install(TrackerHost.parse('tracker.example.org'), readFileSync(certPath, 'utf8'));
      await store.rehash();

      expect(existsSync(join(dir, 'tracker.example.org.pem'))).toBe(true);
      const hashLinks = readdirSync(dir).filter((name) => /^[0-9a-f]{8}\.\d+$/.test(name));
      expect(hashLinks.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!onDebianAsRoot)('rendered BIND zones against named-checkconf', () => {
  it('should_produce_a_zone_file_bind_accepts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-bind-'));
    try {
      const dead = Tracker.discover({
        host: TrackerHost.parse('dead.example.net'),
        proto: TrackerProto.parse('http'),
        port: TrackerPort.parse(80),
        privacy: TrackerPrivacy.parse('private'),
      }).tracker.markDead().tracker;
      const rendered = renderBlacklistZones([dead]);
      const zonesPath = join(dir, 'kobox.zones.blacklists');
      writeFileSync(zonesPath, rendered.content);
      const confPath = join(dir, 'named.conf');
      writeFileSync(
        confPath,
        `options { directory "${dir}"; };\ninclude "${zonesPath}";\n`,
      );

      const result = await runner.run({ command: 'named-checkconf', args: [confPath] });

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!onDebianAsRoot)('HttpsBlocklistDownloadAdapter against a local https server', () => {
  let dir: string;
  let server: ReturnType<typeof createHttpsServer> | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-dl-'));
  });
  afterEach(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function serveBody(body: Buffer): Promise<{ url: string; ca: string }> {
    const { keyPath, certPath } = generateSelfSigned(
      dir,
      'localhost',
      'DNS:localhost,IP:127.0.0.1',
    );
    const ca = readFileSync(certPath, 'utf8');
    server = createHttpsServer(
      { key: readFileSync(keyPath), cert: readFileSync(certPath) },
      (_request, response) => {
        response.writeHead(200);
        response.end(body);
      },
    );
    const port = await listen(server);
    return { url: `https://localhost:${String(port)}/list.gz`, ca };
  }

  it('should_download_and_verify_a_gzipped_p2p_list', async () => {
    const body = gzipSync(Buffer.from('Some org:192.0.2.0-192.0.2.255\n'));
    const { url, ca } = await serveBody(body);
    const adapter = new HttpsBlocklistDownloadAdapter(logger, { ca });

    const list = await adapter.fetch(url);

    expect(list?.ranges).toEqual(['192.0.2.0-192.0.2.255']);
    expect(list?.sha256).toHaveLength(64);
  });

  it('should_reject_a_corrupted_archive', async () => {
    const body = gzipSync(Buffer.from('x'.repeat(200))).subarray(0, 16);
    const { url, ca } = await serveBody(body);
    const adapter = new HttpsBlocklistDownloadAdapter(logger, { ca });

    expect(await adapter.fetch(url)).toBeUndefined();
  });

  it('should_reject_an_untrusted_server_without_the_ca', async () => {
    const body = gzipSync(Buffer.from('Some org:192.0.2.0-192.0.2.255\n'));
    const { url } = await serveBody(body);
    const adapter = new HttpsBlocklistDownloadAdapter(logger);

    expect(await adapter.fetch(url)).toBeUndefined();
  });
});
