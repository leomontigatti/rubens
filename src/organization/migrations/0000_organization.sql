CREATE TABLE `appointment` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`practitioner_id` text NOT NULL,
	`medical_service_id` text NOT NULL,
	`room_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`overbooking` integer DEFAULT false NOT NULL,
	`cancelled_by` text,
	`cancellation_reason` text,
	`reception_note` text,
	`previous_status` text,
	`status_changed_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medical_service_id`) REFERENCES `medical_service`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appointment_span_check" CHECK("appointment"."starts_at" < "appointment"."ends_at"),
	CONSTRAINT "appointment_reception_note_check" CHECK(length("appointment"."reception_note") <= 200),
	CONSTRAINT "appointment_cancelled_check" CHECK(("appointment"."status" = 'cancelled') = ("appointment"."cancelled_by" is not null))
);
--> statement-breakpoint
CREATE INDEX `appointment_patient_id_idx` ON `appointment` (`patient_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointment_practitioner_starts_at_idx` ON `appointment` (`practitioner_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointment_room_starts_at_idx` ON `appointment` (`room_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`patient_id` text,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_patient_id_idx` ON `audit_log` (`patient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `closure` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "closure_span_check" CHECK("closure"."starts_at" < "closure"."ends_at")
);
--> statement-breakpoint
CREATE INDEX `closure_office_id_idx` ON `closure` (`office_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`insurer_id` text NOT NULL,
	`plan` text,
	`member_number` text NOT NULL,
	`primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`insurer_id`) REFERENCES `insurer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `coverage_patient_id_idx` ON `coverage` (`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_primary_unique` ON `coverage` (`patient_id`) WHERE "coverage"."primary";--> statement-breakpoint
CREATE TABLE `guardian` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`name` text NOT NULL,
	`relationship` text NOT NULL,
	`document_type` text,
	`document_number` text,
	`phone` text NOT NULL,
	`email` text,
	`message_contact` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patient`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "guardian_document_check" CHECK(("guardian"."document_type" is null) = ("guardian"."document_number" is null))
);
--> statement-breakpoint
CREATE INDEX `guardian_patient_id_idx` ON `guardian` (`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `guardian_message_contact_unique` ON `guardian` (`patient_id`) WHERE "guardian"."message_contact";--> statement-breakpoint
CREATE TABLE `insurer` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurer_name_unique` ON `insurer` (lower("name"));--> statement-breakpoint
CREATE TABLE `medical_service` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`name` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medical_service_duration_minutes_check" CHECK("medical_service"."duration_minutes" between 1 and 720)
);
--> statement-breakpoint
CREATE INDEX `medical_service_practitioner_id_idx` ON `medical_service` (`practitioner_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`roles` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "member_roles_check" CHECK(json_array_length("member"."roles") >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_email_unique` ON `member` (lower("email"));--> statement-breakpoint
CREATE TABLE `office` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`time_zone` text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `patient` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`chosen_name` text,
	`search_name` text NOT NULL,
	`document_type` text,
	`document_number` text,
	`birth_date` text,
	`phone` text NOT NULL,
	`email` text,
	`address` text,
	`whatsapp_consent` integer DEFAULT true NOT NULL,
	`whatsapp_consent_at` integer NOT NULL,
	`whatsapp_consent_by` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "patient_document_check" CHECK(("patient"."document_type" is null) = ("patient"."document_number" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_document_unique` ON `patient` (`document_type`,`document_number`) WHERE "patient"."document_number" is not null;--> statement-breakpoint
CREATE TABLE `practitioner` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`display_name` text NOT NULL,
	`specialty` text,
	`keeps_clinical_records` integer DEFAULT true NOT NULL,
	`grid_minutes` integer DEFAULT 30 NOT NULL,
	`color` text DEFAULT 'color1' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practitioner_grid_minutes_check" CHECK("practitioner"."grid_minutes" between 5 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practitioner_member_id_unique` ON `practitioner` (`member_id`);--> statement-breakpoint
CREATE TABLE `room` (
	`id` text PRIMARY KEY NOT NULL,
	`office_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "room_capacity_check" CHECK("room"."capacity" >= 1)
);
--> statement-breakpoint
CREATE INDEX `room_office_id_idx` ON `room` (`office_id`);--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`weekdays` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`first_date` text NOT NULL,
	`last_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_weekdays_check" CHECK(json_array_length("schedule"."weekdays") >= 1),
	CONSTRAINT "schedule_times_check" CHECK("schedule"."start_time" < "schedule"."end_time"),
	CONSTRAINT "schedule_dates_check" CHECK("schedule"."last_date" is null or "schedule"."last_date" >= "schedule"."first_date")
);
--> statement-breakpoint
CREATE INDEX `schedule_practitioner_id_idx` ON `schedule` (`practitioner_id`);--> statement-breakpoint
CREATE INDEX `schedule_room_id_idx` ON `schedule` (`room_id`);--> statement-breakpoint
CREATE TABLE `time_off` (
	`id` text PRIMARY KEY NOT NULL,
	`practitioner_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioner`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_off_span_check" CHECK("time_off"."starts_at" < "time_off"."ends_at")
);
--> statement-breakpoint
CREATE INDEX `time_off_practitioner_id_idx` ON `time_off` (`practitioner_id`,`starts_at`);