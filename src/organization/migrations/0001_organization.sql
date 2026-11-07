CREATE TABLE `conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_phone_unique` ON `conversation` (`phone`);--> statement-breakpoint
CREATE TABLE `conversation_patient` (
	`conversation_id` text NOT NULL,
	`patient_id` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `patient_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversation_patient_patient_id_idx` ON `conversation_patient` (`patient_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`whatsapp_id` text NOT NULL,
	`direction` text NOT NULL,
	`type` text NOT NULL,
	`text` text,
	`payload` text NOT NULL,
	`sent_at` integer NOT NULL,
	`status` text,
	`status_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_message_whatsapp_id_unique` ON `whatsapp_message` (`whatsapp_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_message_conversation_idx` ON `whatsapp_message` (`conversation_id`,`sent_at`);