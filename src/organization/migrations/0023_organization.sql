CREATE TABLE `transcription_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`model` text NOT NULL,
	`sandbox` integer NOT NULL,
	`audio_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transcription_usage_day_idx` ON `transcription_usage` (`day`);