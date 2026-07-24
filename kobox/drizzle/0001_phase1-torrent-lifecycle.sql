CREATE TABLE `torrent_instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`scgi_port` integer NOT NULL,
	`rtorrent_port` integer NOT NULL,
	`allow_public_tracker` integer DEFAULT 0 NOT NULL,
	`sync_disabled` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrent_instances_username_unique` ON `torrent_instances` (`username`);--> statement-breakpoint
CREATE TABLE `torrents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`info_hash` text NOT NULL,
	`name` text NOT NULL,
	`label` text,
	`state` text NOT NULL,
	`tree` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `torrents_username_info_hash_unique` ON `torrents` (`username`,`info_hash`);--> statement-breakpoint
CREATE TABLE `watch_dirs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `torrent_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_dirs_instance_id_label_unique` ON `watch_dirs` (`instance_id`,`label`);