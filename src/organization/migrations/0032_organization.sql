CREATE TABLE `opt_out_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`kept` integer NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `opt_out_decision_message_idx` ON `opt_out_decision` (`message_id`);--> statement-breakpoint
ALTER TABLE `notification` ADD `message_id` text;--> statement-breakpoint
ALTER TABLE `notification` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `opt_out_hold` ADD `message_id` text REFERENCES whatsapp_message(id);