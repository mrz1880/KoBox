import { z } from 'zod';
import { INFO_HASH_PATTERN } from '../../domain/torrent/InfoHash.js';
import { LABEL_PATTERN } from '../../domain/torrent/Label.js';
import { IPV4_PATTERN } from '../../domain/shared/IpAddress.js';
import { USERNAME_PATTERN } from '../../domain/user/Username.js';

// The import boundary (AUDIT §"parse at the edge"): every legacy row is
// validated here into a camelCase DTO before any Value Object is constructed.
// The DTOs stay primitive; the domain mappers (domain/migration) are the
// authoritative gate that turns them into VOs.

// SQLite has no boolean type — MySB stores flags as 0/1 integers.
const intBool = z
  .union([z.literal(0), z.literal(1)])
  .transform((value) => value === 1);

const port = z.number().int().min(1).max(65535);

export const mysbUserSchema = z
  .object({
    username: z.string().regex(USERNAME_PATTERN),
    email: z.string().min(3).max(254),
    scgi_port: port,
    rtorrent_port: port,
    proxy_port: port,
    quota_bytes: z.number().int().min(0),
    account_type: z.enum(['normal', 'plex']),
    active: intBool,
  })
  .transform((row) => ({
    username: row.username,
    email: row.email,
    scgiPort: row.scgi_port,
    rtorrentPort: row.rtorrent_port,
    proxyPort: row.proxy_port,
    quotaBytes: row.quota_bytes,
    accountType: row.account_type,
    active: row.active,
  }));

export const mysbTrackerRowSchema = z
  .object({
    host: z.string().min(1).max(253),
    proto: z.enum(['http', 'https', 'udp']),
    port,
    privacy: z.enum(['public', 'private']),
    is_active: intBool,
    is_dead: intBool,
    is_ssl: intBool,
  })
  .transform((row) => ({
    host: row.host,
    proto: row.proto,
    port: row.port,
    privacy: row.privacy,
    isActive: row.is_active,
    isDead: row.is_dead,
    isSsl: row.is_ssl,
  }));

export const mysbTrackerIpv4Schema = z.object({
  host: z.string().min(1).max(253),
  ipv4: z.string().regex(IPV4_PATTERN),
});

export const mysbBlocklistSchema = z
  .object({
    source: z.enum(['iblocklist', 'personal']),
    author: z.string().min(1),
    name: z.string().min(1),
    url: z.string().min(1),
    subscription: intBool,
    enabled: intBool,
  })
  .transform((row) => ({
    source: row.source,
    author: row.author,
    name: row.name,
    url: row.url,
    subscription: row.subscription,
    enabled: row.enabled,
  }));

export const mysbTorrentSchema = z
  .object({
    username: z.string().regex(USERNAME_PATTERN),
    info_hash: z.string().regex(INFO_HASH_PATTERN),
    name: z.string().min(1),
    label: z
      .string()
      .regex(LABEL_PATTERN)
      .nullish(),
    state: z.enum(['loaded', 'completed', 'rejected']),
  })
  .transform((row) => ({
    username: row.username,
    infoHash: row.info_hash.toUpperCase(),
    name: row.name,
    label: row.label ?? undefined,
    state: row.state,
  }));

export const mysbAddressSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN),
  value: z.string().min(1).max(253),
  kind: z.enum(['ipv4', 'hostname']),
});

export type MysbUserRow = z.infer<typeof mysbUserSchema>;
export type MysbTrackerRow = z.infer<typeof mysbTrackerRowSchema>;
export type MysbBlocklistRow = z.infer<typeof mysbBlocklistSchema>;
export type MysbTorrentRow = z.infer<typeof mysbTorrentSchema>;
export type MysbAddressRow = z.infer<typeof mysbAddressSchema>;
