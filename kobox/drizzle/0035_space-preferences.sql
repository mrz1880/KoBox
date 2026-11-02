CREATE TABLE `space_preferences` (
	`username` text PRIMARY KEY NOT NULL,
	`automatic` text DEFAULT 'off' NOT NULL,
	`warned` integer DEFAULT 0 NOT NULL
);
