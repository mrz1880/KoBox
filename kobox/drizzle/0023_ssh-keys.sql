CREATE TABLE `ssh_keys` (
	`username` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`added_at` text NOT NULL
);
