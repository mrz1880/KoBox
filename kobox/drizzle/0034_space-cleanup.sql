CREATE TABLE `cleanup_candidates` (
	`username` text NOT NULL,
	`info_hash` text NOT NULL,
	`name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`ratio_milli` integer NOT NULL,
	`finished_at` text NOT NULL,
	`path` text NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `cleanup_snapshots`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_candidates_username_info_hash_unique` ON `cleanup_candidates` (`username`,`info_hash`);--> statement-breakpoint
CREATE TABLE `cleanup_reports` (
	`username` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`report_json` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cleanup_snapshots` (
	`username` text PRIMARY KEY NOT NULL,
	`taken_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seed_rule` (
	`id` integer PRIMARY KEY NOT NULL,
	`ratio_milli` integer NOT NULL,
	`days` integer NOT NULL
);
