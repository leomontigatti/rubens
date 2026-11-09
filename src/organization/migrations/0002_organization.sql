CREATE TABLE `whatsapp_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`language` text NOT NULL,
	`body` text NOT NULL,
	`meta_id` text NOT NULL,
	`status` text NOT NULL,
	`rejection_reason` text,
	`status_revision` integer DEFAULT 0 NOT NULL,
	`submitted_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_template_meta_id_unique` ON `whatsapp_template` (`meta_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_template_name_version_idx` ON `whatsapp_template` (`name`,`version`);