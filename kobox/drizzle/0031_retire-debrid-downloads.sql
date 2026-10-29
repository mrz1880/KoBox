DROP TABLE `debrid_accounts`;--> statement-breakpoint
DROP TABLE `debrid_downloads`;--> statement-breakpoint
DELETE FROM `components` WHERE `name` = 'aria2';--> statement-breakpoint
DELETE FROM `jobs` WHERE `status` = 'pending' AND `type` IN ('debrid-download', 'poll-debrid-downloads', 'discard-debrid-download', 'set-debrid-key', 'clear-debrid-key');