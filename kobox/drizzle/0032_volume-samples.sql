CREATE TABLE `volume_samples` (
	`id` integer PRIMARY KEY NOT NULL,
	`free_bytes` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`measured_at` text NOT NULL
);
