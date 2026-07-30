import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

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
export const fairUseEvents = sqliteTable(
  'fair_use_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    eventType: text('event_type').notNull(),
    detailJson: text('detail_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('fair_use_events_username_idx').on(table.username)],
);

// The component registry (KoBox successor of the legacy `services` table):
// what `kobox install` attempted, in which state it ended and why. `reason`
// carries skip/failure detail; a failed row re-enters the next plan.
export const components = sqliteTable('components', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  state: text('state', { enum: ['to_install', 'installed', 'failed', 'skipped'] }).notNull(),
  version: text('version'),
  reason: text('reason'),
  installedAt: text('installed_at'),
  updatedAt: text('updated_at').notNull(),
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

// Durable mail outbox (legacy `mails` queue, AUDIT §1.7): notifications land
// here and the scheduled send-mails job flushes them with typed backoff —
// a relay outage delays mail instead of losing it.
export const mails = sqliteTable(
  'mails',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    sentAt: text('sent_at'),
  },
  (table) => [index('mails_status_next_attempt_idx').on(table.status, table.nextAttemptAt)],
);

// Upgrade ledger (§5.6 anti-GitHubRepoUpdate): every staged release leaves a
// truthful row; `current`/`previous` drive the rollback path.
export const releases = sqliteTable('releases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ref: text('ref').notNull(),
  path: text('path').notNull().unique(),
  state: text('state', { enum: ['staged', 'current', 'previous', 'failed'] }).notNull(),
  createdAt: text('created_at').notNull(),
  switchedAt: text('switched_at'),
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

// Portal login credentials (Phase 6): the same crypt sha512 hash the system
// account gets, written by the root worker on create-user/change-password.
// Replaces the shared nginx Basic Auth of the legacy portal (AUDIT §5.5).
export const portalCredentials = sqliteTable('portal_credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  // Phase 7: a migrated user starts with a temporary password and must set a
  // new one at first login before the portal grants any other access.
  mustChangePassword: integer('must_change_password').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

// Server-side sessions; `id` is the sha256 of the cookie token, never the
// token itself.
export const portalSessions = sqliteTable(
  'portal_sessions',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    csrfToken: text('csrf_token').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('portal_sessions_username_idx').on(table.username)],
);

// Portal login throttle state (5 failures -> timed lock); fail2ban reads the
// journald log line, this table backs the in-app lockout.
export const loginAttempts = sqliteTable('login_attempts', {
  username: text('username').primaryKey(),
  failures: integer('failures').notNull().default(0),
  lockedUntil: text('locked_until'),
});

// Phase 9 — DDL/debrid downloads: a user submits a filehoster link, KoBox
// unrestricts it (debrid) and downloads it with aria2 into their home. The
// source link is content, never a secret (the debrid key lives in the worker
// env only). Status drives the poll loop; the gid is aria2's handle.
export const debridDownloads = sqliteTable(
  'debrid_downloads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    category: text('category', { enum: ['films', 'series'] }).notNull(),
    sourceLink: text('source_link').notNull(),
    status: text('status', { enum: ['pending', 'downloading', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    gid: text('gid'),
    filename: text('filename'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('debrid_downloads_status_idx').on(table.status),
    index('debrid_downloads_username_idx').on(table.username),
  ],
);
