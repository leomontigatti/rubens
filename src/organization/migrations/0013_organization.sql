CREATE TABLE `handoff` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`reason` text NOT NULL,
	`clinical` integer NOT NULL,
	`appointment_id` text,
	`state` text DEFAULT 'open' NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `handoff_conversation_idx` ON `handoff` (`conversation_id`,`state`);--> statement-breakpoint
CREATE TABLE `handoff_recipient` (
	`handoff_id` text NOT NULL,
	`member_id` text NOT NULL,
	PRIMARY KEY(`handoff_id`, `member_id`),
	FOREIGN KEY (`handoff_id`) REFERENCES `handoff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `handoff_recipient_member_idx` ON `handoff_recipient` (`member_id`);--> statement-breakpoint
ALTER TABLE `notification` ADD `handoff_id` text;--> statement-breakpoint
ALTER TABLE `conversation` ADD `misunderstandings` integer DEFAULT 0 NOT NULL;