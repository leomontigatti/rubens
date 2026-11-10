CREATE TABLE `opt_out_hold` (
	`patient_id` text PRIMARY KEY NOT NULL,
	`remind_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE no action
);
