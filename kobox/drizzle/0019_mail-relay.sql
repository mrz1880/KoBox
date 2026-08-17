CREATE TABLE `mail_relay` (
	`id` integer PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`user` text NOT NULL,
	`sealed_password` text NOT NULL
);
