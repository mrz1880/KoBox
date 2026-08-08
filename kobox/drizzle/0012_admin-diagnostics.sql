CREATE TABLE `package_snapshot` (
	`id` integer PRIMARY KEY NOT NULL,
	`listing` text NOT NULL,
	`upgradable_count` integer NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_logs` (
	`unit` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`captured_at` text NOT NULL
);
