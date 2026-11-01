ALTER TABLE `blocklists` ADD `failing_since` text;--> statement-breakpoint
ALTER TABLE `blocklists` ADD `failure_reported` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- a list already failing before this column existed: its outage is counted from now
UPDATE `blocklists` SET `failing_since` = strftime('%Y-%m-%d %H:%M:%S', 'now') WHERE `last_update_status` = 'failed';
