ALTER TABLE `outbox_message` ADD `timing` text;--> statement-breakpoint
-- Added by hand: rows queued before this migration take their template's timing as it is now.
UPDATE `outbox_message` SET `timing` = (SELECT `timing` FROM `template` WHERE `template`.`id` = `outbox_message`.`template_id`) WHERE `kind` = 'timed';
