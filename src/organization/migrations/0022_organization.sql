CREATE TABLE `model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`model` text NOT NULL,
	`purpose` text NOT NULL,
	`sandbox` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_usage_day_idx` ON `model_usage` (`day`);