CREATE TABLE `inbox_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`return_after_hours` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "inbox_settings_one_row" CHECK("inbox_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `conversation` ADD `held_by` text REFERENCES member(user_id);--> statement-breakpoint
ALTER TABLE `conversation` ADD `held_until` integer;--> statement-breakpoint
ALTER TABLE `whatsapp_message` ADD `sent_by` text REFERENCES member(user_id);