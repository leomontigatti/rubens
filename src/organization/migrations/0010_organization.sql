CREATE TABLE `communication_rules` (
	`id` integer PRIMARY KEY NOT NULL,
	`form_of_address` text NOT NULL,
	`sign_off` text NOT NULL,
	`tone` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "communication_rules_one_row" CHECK("communication_rules"."id" = 1)
);
