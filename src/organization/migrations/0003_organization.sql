CREATE TABLE `outbox_message` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`appointment_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`due_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`drop_reason` text,
	`error_code` integer,
	`error_message` text,
	`whatsapp_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`whatsapp_message_id`) REFERENCES `whatsapp_message`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `outbox_message_due_idx` ON `outbox_message` (`state`,`due_at`);--> statement-breakpoint
CREATE INDEX `outbox_message_appointment_id_idx` ON `outbox_message` (`appointment_id`);--> statement-breakpoint
ALTER TABLE `medical_service` ADD `booking_confirmation` integer DEFAULT true NOT NULL;