CREATE TABLE `allocated_ports` (
	`port` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`account_type` text NOT NULL,
	`quota_bytes` integer NOT NULL,
	`scgi_port` integer NOT NULL,
	`rtorrent_port` integer NOT NULL,
	`proxy_port` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_scgi_port_unique` ON `users` (`scgi_port`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_rtorrent_port_unique` ON `users` (`rtorrent_port`);