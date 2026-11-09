CREATE TABLE `medical_service_reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`medical_service_id` text NOT NULL,
	`hours_before` integer NOT NULL,
	`asks_to_confirm` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`medical_service_id`) REFERENCES `medical_service`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medical_service_reminder_hours_before_check" CHECK("medical_service_reminder"."hours_before" between 1 and 720)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_service_reminder_service_hours_idx` ON `medical_service_reminder` (`medical_service_id`,`hours_before`);--> statement-breakpoint
ALTER TABLE `medical_service` ADD `care_instructions` text;--> statement-breakpoint
ALTER TABLE `medical_service` ADD `follow_up_hours` integer;--> statement-breakpoint
ALTER TABLE `medical_service` ADD `reschedule_cutoff_hours` integer DEFAULT 24 NOT NULL;