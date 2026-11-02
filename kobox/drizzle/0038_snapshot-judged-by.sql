ALTER TABLE `cleanup_snapshots` ADD `rule_ratio_milli` integer;--> statement-breakpoint
-- SQLite only adds a NOT NULL column with a default: the UPDATE below overwrites
-- it on every row, and the repository always writes the rule, so it is never read.
ALTER TABLE `cleanup_snapshots` ADD `rule_days` integer NOT NULL DEFAULT 0;--> statement-breakpoint
-- A snapshot taken before the rule was kept with it is worded after the rule
-- each member had when this ran, as the page did until then: their own when
-- they set one, the box's an admin set otherwise, else the box default of the
-- time (SeedRule.DEFAULT in src/domain/space/SeedRule.ts: ratio 2, 7 days). The
-- next hourly pass replaces every snapshot with the rule it judged by.
UPDATE `cleanup_snapshots` SET
	`rule_ratio_milli` = CASE
		WHEN (SELECT `own_rule_days` FROM `space_preferences` WHERE `space_preferences`.`username` = `cleanup_snapshots`.`username`) IS NOT NULL
			THEN (SELECT `own_rule_ratio_milli` FROM `space_preferences` WHERE `space_preferences`.`username` = `cleanup_snapshots`.`username`)
		ELSE COALESCE((SELECT `ratio_milli` FROM `seed_rule` WHERE `id` = 1), 2000)
	END,
	`rule_days` = COALESCE(
		(SELECT `own_rule_days` FROM `space_preferences` WHERE `space_preferences`.`username` = `cleanup_snapshots`.`username`),
		(SELECT `days` FROM `seed_rule` WHERE `id` = 1),
		7
	);
