CREATE TABLE `password_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`issued_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_links_token_hash_unique` ON `password_links` (`token_hash`);