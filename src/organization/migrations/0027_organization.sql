-- Edited by hand from drizzle-kit's output: the object's storage refuses
-- `PRAGMA foreign_keys` and migrates inside a transaction, so the rebuilds
-- defer the foreign key checks instead, as in 0020 (`late_reply` rows point
-- at the outbox).
DROP TABLE `medical_service_reminder`;--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_whatsapp_template` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`language` text NOT NULL,
	`body` text NOT NULL,
	`meta_id` text NOT NULL,
	`status` text NOT NULL,
	`rejection_reason` text,
	`category` text DEFAULT 'utility' NOT NULL,
	`status_revision` integer DEFAULT 0 NOT NULL,
	`submitted_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `template`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_whatsapp_template`("id", "template_id", "version", "language", "body", "meta_id", "status", "rejection_reason", "category", "status_revision", "submitted_by", "created_at", "updated_at") SELECT "id", "template_id", "version", "language", "body", "meta_id", "status", "rejection_reason", "category", "status_revision", "submitted_by", "created_at", "updated_at" FROM `whatsapp_template`;--> statement-breakpoint
DROP TABLE `whatsapp_template`;--> statement-breakpoint
ALTER TABLE `__new_whatsapp_template` RENAME TO `whatsapp_template`;--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_template_meta_id_unique` ON `whatsapp_template` (`meta_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_template_template_version_idx` ON `whatsapp_template` (`template_id`,`version`);--> statement-breakpoint
CREATE TABLE `__new_outbox_message` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`appointment_id` text,
	`conversation_id` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`due_at` integer NOT NULL,
	`template_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`drop_reason` text,
	`error_code` integer,
	`error_message` text,
	`whatsapp_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `template`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`whatsapp_message_id`) REFERENCES `whatsapp_message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_outbox_message`("id", "kind", "appointment_id", "conversation_id", "state", "due_at", "template_id", "attempts", "drop_reason", "error_code", "error_message", "whatsapp_message_id", "created_at", "updated_at") SELECT "id", "kind", "appointment_id", "conversation_id", "state", "due_at", "template_id", "attempts", "drop_reason", "error_code", "error_message", "whatsapp_message_id", "created_at", "updated_at" FROM `outbox_message`;--> statement-breakpoint
DROP TABLE `outbox_message`;--> statement-breakpoint
ALTER TABLE `__new_outbox_message` RENAME TO `outbox_message`;--> statement-breakpoint
CREATE INDEX `outbox_message_due_idx` ON `outbox_message` (`state`,`due_at`);--> statement-breakpoint
CREATE INDEX `outbox_message_appointment_id_idx` ON `outbox_message` (`appointment_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
ALTER TABLE `medical_service` DROP COLUMN `booking_confirmation`;--> statement-breakpoint
ALTER TABLE `medical_service` DROP COLUMN `care_instructions`;--> statement-breakpoint
ALTER TABLE `medical_service` DROP COLUMN `follow_up_hours`;--> statement-breakpoint
ALTER TABLE `notification` DROP COLUMN `template_name`;