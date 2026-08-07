CREATE TABLE `speedtests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`download_bps` integer NOT NULL,
	`upload_bps` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`server` text NOT NULL,
	`measured_at` text NOT NULL
);
