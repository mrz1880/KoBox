CREATE TABLE `components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`version` text,
	`reason` text,
	`installed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `components_name_unique` ON `components` (`name`);--> statement-breakpoint
CREATE INDEX `fair_use_events_username_idx` ON `fair_use_events` (`username`);