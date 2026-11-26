-- Edited by hand from drizzle-kit's output: the object's storage refuses
-- `PRAGMA foreign_keys` and migrates inside a transaction, so the rebuild
-- defers the foreign key checks instead, as in 0020; and the copy reads only
-- the columns the old table has.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`appointment_id` text,
	`kind` text NOT NULL,
	`statement` text NOT NULL,
	`patient_id` text,
	`medical_service_id` text,
	`practitioner_id` text,
	`room_id` text,
	`starts_at` integer,
	`ends_at` integer,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medical_service_id`) REFERENCES `medical_service`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_proposal`("id", "conversation_id", "appointment_id", "kind", "statement", "starts_at", "expires_at", "accepted_at", "created_at", "updated_at") SELECT "id", "conversation_id", "appointment_id", "kind", "statement", "starts_at", "expires_at", "accepted_at", "created_at", "updated_at" FROM `proposal`;--> statement-breakpoint
DROP TABLE `proposal`;--> statement-breakpoint
ALTER TABLE `__new_proposal` RENAME TO `proposal`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE INDEX `proposal_conversation_idx` ON `proposal` (`conversation_id`,`created_at`);