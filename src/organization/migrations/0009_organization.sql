CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`kind` text NOT NULL,
	`template_name` text,
	`template_version` integer,
	`detail` text,
	`until` integer,
	`waiting` integer,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipient_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notification_recipient_idx` ON `notification` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `whatsapp_number_hold` (
	`id` integer PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "whatsapp_number_hold_one_row" CHECK("whatsapp_number_hold"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `whatsapp_template` ADD `category` text DEFAULT 'utility' NOT NULL;