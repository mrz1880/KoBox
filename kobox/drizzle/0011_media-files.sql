CREATE TABLE `media_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`indexed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_files_username_path_unique` ON `media_files` (`username`,`path`);