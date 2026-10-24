PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_portal_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`role` text DEFAULT 'user' NOT NULL,
	`must_change_password` integer DEFAULT 0 NOT NULL,
	`app_token_hash` text,
	`language` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_portal_credentials`("id", "username", "password_hash", "role", "must_change_password", "app_token_hash", "language", "updated_at") SELECT "id", "username", "password_hash", "role", "must_change_password", "app_token_hash", "language", "updated_at" FROM `portal_credentials`;--> statement-breakpoint
DROP TABLE `portal_credentials`;--> statement-breakpoint
ALTER TABLE `__new_portal_credentials` RENAME TO `portal_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `portal_credentials_username_unique` ON `portal_credentials` (`username`);