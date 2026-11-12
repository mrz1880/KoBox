CREATE TABLE `stalled_hash_checks` (
	`username` text NOT NULL,
	`info_hash` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `stalled_hash_checks_username_info_hash_unique` ON `stalled_hash_checks` (`username`,`info_hash`);