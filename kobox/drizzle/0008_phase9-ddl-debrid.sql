CREATE TABLE `debrid_downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`category` text NOT NULL,
	`source_link` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`gid` text,
	`filename` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `debrid_downloads_status_idx` ON `debrid_downloads` (`status`);--> statement-breakpoint
CREATE INDEX `debrid_downloads_username_idx` ON `debrid_downloads` (`username`);