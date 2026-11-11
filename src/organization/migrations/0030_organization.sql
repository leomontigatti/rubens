-- Edited by hand from drizzle-kit's output: `handoff.clinical` is renamed before the
-- rebuild that drops `opt_out_reported_through` and adds `detail` copies it, and the
-- rebuild defers the foreign key checks as in 0027 (`handoff_recipient` and
-- `notification` rows point at the handoff). The last two statements are added by
-- hand: a message's judgement now says whether it needs the practitioner, and an
-- earlier judgement keeps its sense.
ALTER TABLE `late_reply` RENAME COLUMN "reads_clinical" TO "keeps_records";--> statement-breakpoint
ALTER TABLE `handoff` RENAME COLUMN "clinical" TO "for_practitioner";--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_handoff` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`reason` text NOT NULL,
	`for_practitioner` integer NOT NULL,
	`appointment_id` text,
	`state` text DEFAULT 'open' NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`held_reply` text,
	`detail` text,
	`counts_down` integer DEFAULT false NOT NULL,
	`reminded_for` integer,
	`widely_reminded_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_handoff`("id", "conversation_id", "reason", "for_practitioner", "appointment_id", "state", "closed_at", "closed_by", "held_reply", "counts_down", "reminded_for", "widely_reminded_for", "created_at", "updated_at") SELECT "id", "conversation_id", "reason", "for_practitioner", "appointment_id", "state", "closed_at", "closed_by", "held_reply", "counts_down", "reminded_for", "widely_reminded_for", "created_at", "updated_at" FROM `handoff`;--> statement-breakpoint
DROP TABLE `handoff`;--> statement-breakpoint
ALTER TABLE `__new_handoff` RENAME TO `handoff`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE INDEX `handoff_conversation_idx` ON `handoff` (`conversation_id`,`state`);--> statement-breakpoint
ALTER TABLE `late_reply` DROP COLUMN `clinical`;--> statement-breakpoint
UPDATE `whatsapp_message` SET `judgement` = 'forPractitioner' WHERE `judgement` = 'clinical';--> statement-breakpoint
UPDATE `whatsapp_message` SET `judgement` = 'notForPractitioner' WHERE `judgement` = 'notClinical';
