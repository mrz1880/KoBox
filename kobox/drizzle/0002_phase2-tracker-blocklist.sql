CREATE TABLE `blocklists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`author` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`subscription` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`last_update_status` text,
	`last_update_at` text,
	`sha256` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocklists_source_author_name_unique` ON `blocklists` (`source`,`author`,`name`);--> statement-breakpoint
CREATE TABLE `tracker_ipv4` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tracker_id` integer NOT NULL,
	`ipv4` text NOT NULL,
	FOREIGN KEY (`tracker_id`) REFERENCES `trackers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracker_ipv4_tracker_id_ipv4_unique` ON `tracker_ipv4` (`tracker_id`,`ipv4`);--> statement-breakpoint
CREATE TABLE `trackers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host` text NOT NULL,
	`domain` text NOT NULL,
	`proto` text NOT NULL,
	`port` integer NOT NULL,
	`privacy` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`is_dead` integer DEFAULT 0 NOT NULL,
	`is_ssl` integer DEFAULT 0 NOT NULL,
	`check_state` text NOT NULL,
	`cert_expiration` text,
	`last_check` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trackers_host_unique` ON `trackers` (`host`);--> statement-breakpoint
CREATE TABLE `user_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`ipv4` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_addresses_username_ipv4_unique` ON `user_addresses` (`username`,`ipv4`);