CREATE TABLE `fair_use_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`event_type` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fair_use_policies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`egress_limit_bps` integer,
	`auth_rate_per_hour` integer,
	`throttle_to_bps` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fair_use_policies_username_unique` ON `fair_use_policies` (`username`);--> statement-breakpoint
CREATE TABLE `fair_use_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`level` text NOT NULL,
	`health_state` text DEFAULT 'healthy' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fair_use_state_username_unique` ON `fair_use_state` (`username`);--> statement-breakpoint
CREATE TABLE `usage_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`egress_bytes` integer NOT NULL,
	`ingress_bytes` integer NOT NULL,
	`sampled_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_samples_username_unique` ON `usage_samples` (`username`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`ipv4` text,
	`check_by` text DEFAULT 'ipv4' NOT NULL,
	`hostname` text
);
--> statement-breakpoint
INSERT INTO `__new_user_addresses`("id", "username", "ipv4", "check_by", "hostname") SELECT "id", "username", "ipv4", 'ipv4', NULL FROM `user_addresses`;--> statement-breakpoint
DROP TABLE `user_addresses`;--> statement-breakpoint
ALTER TABLE `__new_user_addresses` RENAME TO `user_addresses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_addresses_username_ipv4_unique` ON `user_addresses` (`username`,`ipv4`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_addresses_username_hostname_unique` ON `user_addresses` (`username`,`hostname`);