PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cleanup_reports` (
	`username` text NOT NULL,
	`trigger` text NOT NULL,
	`report_json` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_cleanup_reports`("username", "trigger", "report_json", "at") SELECT "username", "trigger", "report_json", "at" FROM `cleanup_reports`;--> statement-breakpoint
DROP TABLE `cleanup_reports`;--> statement-breakpoint
ALTER TABLE `__new_cleanup_reports` RENAME TO `cleanup_reports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_reports_username_trigger_unique` ON `cleanup_reports` (`username`,`trigger`);