import { createHash } from 'node:crypto';

// Minimal bencode encoder for building .torrent fixtures in tests.
export type Bencodable =
  | number
  | string
  | Buffer
  | Bencodable[]
  | { [key: string]: Bencodable };

export function bencode(value: Bencodable): Buffer {
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

export interface TorrentFixture {
  readonly data: Buffer;
  readonly infoHash: string; // uppercase hex, as rtorrent reports it
}

export function aTorrentFile(options: {
  readonly name: string;
  readonly isPrivate: boolean;
  readonly announce?: string;
}): TorrentFixture {
  const info: Record<string, Bencodable> = {
    name: options.name,
    'piece length': 262144,
    pieces: Buffer.alloc(20),
    length: 1024,
    ...(options.isPrivate && { private: 1 }),
  };
  const data = bencode({
    announce: options.announce ?? 'https://tracker.example.org/announce',
    info,
  });
  const infoHash = createHash('sha1').update(bencode(info)).digest('hex').toUpperCase();
  return { data, infoHash };
}
