import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Announcer } from '../../domain/torrent/Announcer.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import type { TorrentMetainfo, TorrentMetainfoPort } from '../../domain/torrent/ports.js';

type BValue = number | Buffer | BValue[] | BDict;
interface BDict {
  [key: string]: BValue;
}

class BencodeError extends Error {}

// Minimal, dependency-free bencode decoder. Only what metainfo needs; any
// malformed input surfaces as BencodeError and the adapter returns undefined.
class Decoder {
  private pos = 0;
  // Byte span of the top-level 'info' value: its sha1 IS the info hash.
  infoStart = -1;
  infoEnd = -1;

  constructor(private readonly buf: Buffer) {}

  decodeTopLevelDict(): BDict {
    if (this.buf[this.pos] !== 0x64) {
      throw new BencodeError('top level is not a dict');
    }
    this.pos += 1;
    const dict: BDict = {};
    while (this.buf[this.pos] !== 0x65) {
      const key = this.decodeString().toString('utf8');
      const start = this.pos;
      dict[key] = this.decodeValue();
      if (key === 'info') {
        this.infoStart = start;
        this.infoEnd = this.pos;
      }
    }
    this.pos += 1;
    return dict;
  }

  private decodeValue(): BValue {
    const byte = this.buf[this.pos];
    if (byte === undefined) {
      throw new BencodeError('unexpected end of input');
    }
    if (byte === 0x69) {
      return this.decodeInteger();
    }
    if (byte === 0x6c) {
      return this.decodeList();
    }
    if (byte === 0x64) {
      return this.decodeDict();
    }
    return this.decodeString();
  }

  private decodeInteger(): number {
    const end = this.buf.indexOf(0x65, this.pos);
    if (end === -1) {
      throw new BencodeError('unterminated integer');
    }
    const raw = this.buf.subarray(this.pos + 1, end).toString('ascii');
    if (!/^-?\d+$/.test(raw)) {
      throw new BencodeError('invalid integer');
    }
    this.pos = end + 1;
    return Number(raw);
  }

  private decodeString(): Buffer {
    const colon = this.buf.indexOf(0x3a, this.pos);
    if (colon === -1) {
      throw new BencodeError('unterminated string length');
    }
    const rawLength = this.buf.subarray(this.pos, colon).toString('ascii');
    if (!/^\d+$/.test(rawLength)) {
      throw new BencodeError('invalid string length');
    }
    const length = Number(rawLength);
    const start = colon + 1;
    if (start + length > this.buf.length) {
      throw new BencodeError('string overruns input');
    }
    this.pos = start + length;
    return this.buf.subarray(start, start + length);
  }

  private decodeList(): BValue[] {
    this.pos += 1;
    const list: BValue[] = [];
    while (this.buf[this.pos] !== 0x65) {
      list.push(this.decodeValue());
    }
    this.pos += 1;
    return list;
  }

  private decodeDict(): BDict {
    this.pos += 1;
    const dict: BDict = {};
    while (this.buf[this.pos] !== 0x65) {
      const key = this.decodeString().toString('utf8');
      dict[key] = this.decodeValue();
    }
    this.pos += 1;
    return dict;
  }
}

function asBuffer(value: BValue | undefined): Buffer | undefined {
  return Buffer.isBuffer(value) ? value : undefined;
}

function collectAnnouncers(top: BDict): readonly Announcer[] {
  const urls: string[] = [];
  const push = (value: BValue | undefined): void => {
    const raw = asBuffer(value)?.toString('utf8');
    if (raw !== undefined && !urls.includes(raw)) {
      urls.push(raw);
    }
  };
  push(top.announce);
  const tiers = top['announce-list'];
  if (Array.isArray(tiers)) {
    for (const tier of tiers) {
      if (Array.isArray(tier)) {
        tier.forEach(push);
      }
    }
  }
  const announcers: Announcer[] = [];
  for (const url of urls) {
    try {
      announcers.push(Announcer.parse(url));
    } catch {
      // unsupported protocol or unsafe host: skip, never fail the whole read
    }
  }
  return announcers;
}

export class BencodeMetainfoAdapter implements TorrentMetainfoPort {
  read(path: string): Promise<TorrentMetainfo | undefined> {
    try {
      const buf = readFileSync(path);
      const decoder = new Decoder(buf);
      const top = decoder.decodeTopLevelDict();
      const info = top.info;
      if (typeof info !== 'object' || Array.isArray(info) || Buffer.isBuffer(info)) {
        return Promise.resolve(undefined);
      }
      const name = asBuffer(info.name)?.toString('utf8');
      if (name === undefined || name === '' || decoder.infoStart < 0) {
        return Promise.resolve(undefined);
      }
      const infoHash = InfoHash.parse(
        createHash('sha1').update(buf.subarray(decoder.infoStart, decoder.infoEnd)).digest('hex'),
      );
      return Promise.resolve({
        infoHash,
        name,
        isPrivate: info.private === 1,
        announcers: collectAnnouncers(top),
      });
    } catch {
      // missing file or malformed bencode: the native early-exit case
      return Promise.resolve(undefined);
    }
  }
}
