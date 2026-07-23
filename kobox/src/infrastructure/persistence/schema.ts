import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
