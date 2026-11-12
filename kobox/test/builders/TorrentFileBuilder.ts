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

const PIECE_LENGTH = 262144;
// what a fixture without content claims to hold: its pieces match nothing
const PLACEHOLDER_LENGTH = 1024;
const SHA1_LENGTH = 20;

// The SHA-1 of each piece, end to end, as the info dictionary carries them: a
// client checking files against them finds the content whole.
function pieceHashes(content: Buffer): Buffer {
  const hashes: Buffer[] = [];
  for (let offset = 0; offset < content.length; offset += PIECE_LENGTH) {
    hashes.push(
      createHash('sha1')
        .update(content.subarray(offset, offset + PIECE_LENGTH))
        .digest(),
    );
  }
  return Buffer.concat(hashes);
}

// A single-file torrent. With `content`, its pieces are the real hashes of
// those bytes, so a client loading it next to a file holding them sees the
// download complete; without, the pieces match nothing.
export function aTorrentFile(options: {
  readonly name: string;
  readonly isPrivate: boolean;
  readonly announce?: string;
  readonly content?: Buffer;
  // without content, how many bytes it claims to hold: its pieces still match nothing
  readonly claimedBytes?: number;
}): TorrentFixture {
  const claimed = options.claimedBytes ?? PLACEHOLDER_LENGTH;
  const info: Record<string, Bencodable> = {
    name: options.name,
    'piece length': PIECE_LENGTH,
    pieces:
      options.content === undefined
        ? Buffer.alloc(SHA1_LENGTH * Math.ceil(claimed / PIECE_LENGTH))
        : pieceHashes(options.content),
    length: options.content?.length ?? claimed,
    ...(options.isPrivate && { private: 1 }),
  };
  const data = bencode({
    announce: options.announce ?? 'https://tracker.example.org/announce',
    info,
  });
  const infoHash = createHash('sha1').update(bencode(info)).digest('hex').toUpperCase();
  return { data, infoHash };
}
