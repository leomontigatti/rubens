ALTER TABLE `handoff` ADD `counts_down` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `handoff` ADD `reminded_for` integer;--> statement-breakpoint
ALTER TABLE `handoff` ADD `widely_reminded_for` integer;--> statement-breakpoint
ALTER TABLE `inbox_settings` ADD `handoff_reminder_hours` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_settings` ADD `handoff_wide_reminder_hours` integer DEFAULT 2 NOT NULL;