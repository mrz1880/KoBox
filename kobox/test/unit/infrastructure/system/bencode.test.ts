import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BencodeMetainfoAdapter } from '../../../../src/infrastructure/system/BencodeMetainfoAdapter.js';

// Minimal bencode encoder for fixtures only (kept in test code on purpose).
type Bencodable = number | string | Buffer | Bencodable[] | { [key: string]: Bencodable };

function bencode(value: Bencodable): Buffer {
  if (typeof value === 'number') {
    return Buffer.from(`i${String(value)}e`);
  }
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([Buffer.from(`${String(raw.length)}:`), raw]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  }
  const entries = Object.keys(value)
    .sort()
    .flatMap((key) => [bencode(key), bencode(value[key] ?? 0)]);
  return Buffer.concat([Buffer.from('d'), ...entries, Buffer.from('e')]);
}

function torrentFixture(info: Record<string, Bencodable>, top: Record<string, Bencodable>): Buffer {
  return bencode({ ...top, info });
}

const PRIVATE_INFO = {
  name: 'debian-netinst.iso',
  'piece length': 262144,
  pieces: Buffer.alloc(20),
  length: 1024,
  private: 1,
};

describe('BencodeMetainfoAdapter', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kobox-bencode-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, data: Buffer): string {
    const path = join(dir, name);
    writeFileSync(path, data);
    return path;
  }

  it('should_extract_name_privacy_announcers_and_the_real_info_hash', async () => {
    const path = write(
      'private.torrent',
      torrentFixture(PRIVATE_INFO, {
        announce: 'https://tracker.example.org:2710/announce',
        'announce-list': [['https://tracker.example.org:2710/announce'], ['udp://open.example.io:6969']],
      }),
    );
    const adapter = new BencodeMetainfoAdapter();

    const metainfo = await adapter.read(path);

    expect(metainfo?.name).toBe('debian-netinst.iso');
    expect(metainfo?.isPrivate).toBe(true);
    expect(metainfo?.announcers.map((a) => a.url)).toEqual([
      'https://tracker.example.org:2710/announce',
      'udp://open.example.io:6969',
    ]);
    const expectedHash = createHash('sha1').update(bencode(PRIVATE_INFO)).digest('hex');
    expect(metainfo?.infoHash.value).toBe(expectedHash.toUpperCase());
  });

  it('should_default_to_public_when_the_private_flag_is_absent', async () => {
    const publicInfo = Object.fromEntries(
      Object.entries(PRIVATE_INFO).filter(([key]) => key !== 'private'),
    );
    const path = write(
      'public.torrent',
      torrentFixture(publicInfo, { announce: 'http://t.example.net/announce' }),
    );

    const metainfo = await new BencodeMetainfoAdapter().read(path);

    expect(metainfo?.isPrivate).toBe(false);
  });

  it('should_skip_announcers_with_unsupported_protocols', async () => {
    const path = write(
      'weird.torrent',
      torrentFixture(PRIVATE_INFO, {
        announce: 'wss://ws.example.org/announce',
        'announce-list': [['https://ok.example.org/announce']],
      }),
    );

    const metainfo = await new BencodeMetainfoAdapter().read(path);

    expect(metainfo?.announcers.map((a) => a.url)).toEqual(['https://ok.example.org/announce']);
  });

  it('should_return_undefined_for_a_missing_file', async () => {
    expect(await new BencodeMetainfoAdapter().read(join(dir, 'nope.torrent'))).toBeUndefined();
  });

  it('should_return_undefined_for_garbage_never_throwing', async () => {
    const adapter = new BencodeMetainfoAdapter();
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 256 }), async (bytes) => {
        const path = write('garbage.torrent', Buffer.from(bytes));
        expect(await adapter.read(path)).toBeUndefined();
      }),
      { numRuns: 25 },
    );
  });
});
