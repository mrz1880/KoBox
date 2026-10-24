ALTER TABLE `users` ADD `vpn_host` integer;--> statement-breakpoint
UPDATE `users` SET `vpn_host` = 1 + (SELECT count(*) FROM `users` AS `earlier` WHERE `earlier`.`id` <= `users`.`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_vpn_host_unique` ON `users` (`vpn_host`);
