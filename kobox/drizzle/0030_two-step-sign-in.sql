ALTER TABLE `portal_credentials` ADD `two_step_secret` text;--> statement-breakpoint
ALTER TABLE `portal_credentials` ADD `two_step_last_step` integer;--> statement-breakpoint
ALTER TABLE `portal_credentials` ADD `two_step_pending` text;--> statement-breakpoint
ALTER TABLE `portal_sessions` ADD `awaiting_code` integer DEFAULT 0 NOT NULL;