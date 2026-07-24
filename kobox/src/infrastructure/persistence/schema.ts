import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  email: text('email').notNull(),
  accountType: text('account_type', { enum: ['normal', 'plex'] }).notNull(),
  quotaBytes: integer('quota_bytes').notNull(),
  scgiPort: integer('scgi_port').notNull().unique(),
  rtorrentPort: integer('rtorrent_port').notNull().unique(),
  proxyPort: integer('proxy_port').notNull(),
  status: text('status', { enum: ['active', 'suspended'] }).notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Ledger keyed by port number: INSERT under a write transaction is the
// atomic claim (no read-then-write race, unlike the legacy max()+1).
export const allocatedPorts = sqliteTable('allocated_ports', {
  port: integer('port').primaryKey(),
  kind: text('kind', { enum: ['scgi', 'rtorrent'] }).notNull(),
});

// One rtorrent instance per user. The two prod file patches become
// first-class flags here: DB survives restarts, files never carry behavior.
export const torrentInstances = sqliteTable('torrent_instances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  scgiPort: integer('scgi_port').notNull(),
  rtorrentPort: integer('rtorrent_port').notNull(),
  allowPublicTracker: integer('allow_public_tracker').notNull().default(0),
  syncDisabled: integer('sync_disabled').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const watchDirs = sqliteTable(
  'watch_dirs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    instanceId: integer('instance_id')
      .notNull()
      .references(() => torrentInstances.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
  },
  (table) => [unique().on(table.instanceId, table.label)],
);

export const torrents = sqliteTable(
  'torrents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    infoHash: text('info_hash').notNull(),
    name: text('name').notNull(),
    label: text('label'),
    state: text('state', { enum: ['loaded', 'completed', 'rejected'] }).notNull(),
    tree: text('tree'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [unique().on(table.username, table.infoHash)],
);

// The tracker whitelist (legacy trackers_list). check_state replaces the
// magic to_check ∈ {0,1,3}; cert_expiration keeps the REAL notAfter date
// (the legacy stored it skewed by -2 days; the margin now lives in CertExpiry).
export const trackers = sqliteTable('trackers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  host: text('host').notNull().unique(),
  domain: text('domain').notNull(),
  proto: text('proto', { enum: ['http', 'https', 'udp'] }).notNull(),
  port: integer('port').notNull(),
  privacy: text('privacy', { enum: ['public', 'private'] }).notNull(),
  isActive: integer('is_active').notNull().default(1),
  isDead: integer('is_dead').notNull().default(0),
  isSsl: integer('is_ssl').notNull().default(0),
  checkState: text('check_state', { enum: ['none', 'pending', 'checking'] }).notNull(),
  certExpiration: text('cert_expiration'),
  lastCheck: text('last_check'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const trackerIpv4 = sqliteTable(
  'tracker_ipv4',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    trackerId: integer('tracker_id')
      .notNull()
      .references(() => trackers.id, { onDelete: 'cascade' }),
    ipv4: text('ipv4').notNull(),
  },
  (table) => [unique().on(table.trackerId, table.ipv4)],
);

export const blocklists = sqliteTable(
  'blocklists',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source', { enum: ['iblocklist', 'personal'] }).notNull(),
    author: text('author').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    subscription: integer('subscription').notNull().default(0),
    enabled: integer('enabled').notNull().default(0),
    lastUpdateStatus: text('last_update_status', { enum: ['ok', 'failed'] }),
    lastUpdateAt: text('last_update_at'),
    sha256: text('sha256'),
  },
  (table) => [unique().on(table.source, table.author, table.name)],
);

// Per-user allow-list entries (legacy users_addresses). Two flavors: static
// IPv4 rows, and DynDNS hostname rows whose ipv4 holds the LAST RESOLVED
// address (null until the first successful resolution).
export const userAddresses = sqliteTable(
  'user_addresses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    ipv4: text('ipv4'),
    checkBy: text('check_by', { enum: ['ipv4', 'hostname'] })
      .notNull()
      .default('ipv4'),
    hostname: text('hostname'),
  },
  (table) => [unique().on(table.username, table.ipv4), unique().on(table.username, table.hostname)],
);

// Graduated-response state machine per user (none -> alerted -> throttled);
// health transition tracking rides along to dedupe ServiceUnhealthy alerts.
export const fairUseState = sqliteTable('fair_use_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  level: text('level', { enum: ['none', 'alerted', 'throttled'] }).notNull(),
  healthState: text('health_state', { enum: ['healthy', 'unhealthy'] })
    .notNull()
    .default('healthy'),
  updatedAt: text('updated_at').notNull(),
});

// Append-only audit trail: every fair-use decision is traceable (locked
// decision 2026-07-23 — reversible AND audited).
export const fairUseEvents = sqliteTable('fair_use_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  eventType: text('event_type').notNull(),
  detailJson: text('detail_json').notNull(),
  createdAt: text('created_at').notNull(),
});

// Per-user overrides only; installation defaults live in composition.
export const fairUsePolicies = sqliteTable('fair_use_policies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  egressLimitBps: integer('egress_limit_bps'),
  authRatePerHour: integer('auth_rate_per_hour'),
  throttleToBps: integer('throttle_to_bps'),
});

// Last cumulative meter reading per user — the delta basis for rates.
export const usageSamples = sqliteTable('usage_samples', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  egressBytes: integer('egress_bytes').notNull(),
  ingressBytes: integer('ingress_bytes').notNull(),
  sampledAt: text('sampled_at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull(),
  status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
    .notNull()
    .default('pending'),
  error: text('error'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});
