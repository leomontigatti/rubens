CREATE TABLE `whatsapp_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_account_id` text NOT NULL,
	`phone_number_id` text NOT NULL,
	`display_number` text NOT NULL,
	`messaging_limit` text,
	`state` text NOT NULL,
	`failure_reason` text,
	`access_token` text,
	`pin` text,
	`connected_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "whatsapp_connection_one_row" CHECK("whatsapp_connection"."id" = 1)
);
