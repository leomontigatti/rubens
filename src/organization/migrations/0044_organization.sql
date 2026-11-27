CREATE TABLE `rejected_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`element` text NOT NULL,
	`issues` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rejected_webhook_event_created_idx` ON `rejected_webhook_event` (`created_at`);--> statement-breakpoint
ALTER TABLE `conversation` ADD `turn_claimed_until` integer;