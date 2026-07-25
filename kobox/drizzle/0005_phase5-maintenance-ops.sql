CREATE TABLE `mails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE INDEX `mails_status_next_attempt_idx` ON `mails` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ref` text NOT NULL,
	`path` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`switched_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_path_unique` ON `releases` (`path`);--> statement-breakpoint
-- Phase 5 decision: pgl is retired (Debian 12 never packaged it); ipset
-- replaces kernel-level blocklist enforcement. Drop the stale registry row
-- so install-status stops advertising a component that no longer exists.
DELETE FROM `components` WHERE `name` = 'pgl';