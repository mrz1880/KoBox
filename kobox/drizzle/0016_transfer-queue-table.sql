CREATE TABLE `sync_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`queued_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_transfers_state_idx` ON `sync_transfers` (`username`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_transfers_username_source_unique` ON `sync_transfers` (`username`,`source`);