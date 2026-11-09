CREATE TABLE `proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`kind` text NOT NULL,
	`statement` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proposal_conversation_idx` ON `proposal` (`conversation_id`,`created_at`);