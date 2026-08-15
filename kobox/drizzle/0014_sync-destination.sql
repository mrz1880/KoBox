CREATE TABLE `sync_destinations` (
	`username` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`account` text NOT NULL,
	`sealed_password` text NOT NULL,
	`path` text NOT NULL,
	`batch_size` integer DEFAULT 0 NOT NULL,
	`placement` text DEFAULT 'beside-the-others' NOT NULL,
	`last_check_ok` integer,
	`last_check_at` text,
	`last_check_detail` text,
	`last_check_fingerprint` text
);
