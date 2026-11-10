-- Edited by hand from drizzle-kit's output: the object's storage refuses
-- `PRAGMA foreign_keys` and migrates inside a transaction, so the rebuild
-- defers the foreign key checks instead; the copy fills the new column with
-- NULL, which drizzle-kit read from the old table; and `late_reply` is
-- created after the rebuild, so the dropped table is no row's parent.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_outbox_message` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`appointment_id` text,
	`conversation_id` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`due_at` integer NOT NULL,
	`hours_before` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`drop_reason` text,
	`error_code` integer,
	`error_message` text,
	`whatsapp_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`whatsapp_message_id`) REFERENCES `whatsapp_message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_outbox_message`("id", "kind", "appointment_id", "conversation_id", "state", "due_at", "hours_before", "attempts", "drop_reason", "error_code", "error_message", "whatsapp_message_id", "created_at", "updated_at") SELECT "id", "kind", "appointment_id", NULL, "state", "due_at", "hours_before", "attempts", "drop_reason", "error_code", "error_message", "whatsapp_message_id", "created_at", "updated_at" FROM `outbox_message`;--> statement-breakpoint
DROP TABLE `outbox_message`;--> statement-breakpoint
ALTER TABLE `__new_outbox_message` RENAME TO `outbox_message`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE INDEX `outbox_message_due_idx` ON `outbox_message` (`state`,`due_at`);--> statement-breakpoint
CREATE INDEX `outbox_message_appointment_id_idx` ON `outbox_message` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `late_reply` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`written_by` text NOT NULL,
	`text` text NOT NULL,
	`reads_clinical` integer NOT NULL,
	`clinical` integer NOT NULL,
	`state` text DEFAULT 'waiting' NOT NULL,
	`reopen_id` text NOT NULL,
	`whatsapp_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`written_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopen_id`) REFERENCES `outbox_message`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`whatsapp_message_id`) REFERENCES `whatsapp_message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `late_reply_state_idx` ON `late_reply` (`state`,`conversation_id`);--> statement-breakpoint
ALTER TABLE `notification` ADD `conversation_id` text;
